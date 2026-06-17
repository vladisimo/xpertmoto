/**
 * GPS51 fleet-tracking integration (api.gps51.com).
 *
 * Transport: HTTP POST to `<baseUrl>/webapi?action=<a>&token=<t>&serverid=<s>`
 * with a JSON body. Response `status` is `0` on success; `>8900` are errors
 * (see ERROR_MESSAGES). Contract verified against the GPS51 gitee wiki; items
 * tagged VERIFY are resolved on the first authenticated call (see the plan).
 *
 * - `runGps51Sync` is the continuous poller's worker: one batched `lastposition`
 *   call → upsert `VehicleLivePosition` (the live-map snapshot). It no longer
 *   writes history — full-fidelity history is owned by the nightly sync below.
 * - `runGps51DailyTrackSync` is the once-a-day worker: per device it pulls the
 *   last 24h via `queryTracks` and appends every fix to the `VehicleTelemetry`
 *   hypertable (deduped by the composite PK). One pull/device/day stays within
 *   the provider's ≤5/device/day cap.
 * - `queryTracks` is Redis-metered (≤5/device/day) — shared by the nightly sync
 *   and on-demand manager pulls.
 *
 * Credentials are env-only via integration-config (`integration:gps51:*`). The
 * password is MD5'd at login; nothing here logs the password or token (the pino
 * logger also redacts those paths).
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getSecret, getString } from "@/lib/integration-config";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const log = logger.child({ service: "gps51" });

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // token lives 24h; refresh at 23h
const TRACKS_DAILY_LIMIT = 5; // provider cap: 5 querytracks/device/day

// Daily full-track sync tuning. querytracks shares the account's single-IP quota
// with the 1-min poll; GPS51 caps one IP at 10 requests/min (error 8902), so
// pace device pulls to stay comfortably under that. Day-long tracks for an active
// vehicle can be thousands of fixes — insert them in bounded chunks.
const DAILY_TRACK_THROTTLE_MS = 7000; // ~8.5 querytracks/min, leaves headroom for the poll
const TELEMETRY_INSERT_CHUNK = 1000;
const DEVICE_ERROR_SAMPLE_LIMIT = 50; // cap stored per-device errors in the run summary

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class Gps51Error extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly action?: string,
  ) {
    super(message);
    this.name = "Gps51Error";
  }
}

/** Thrown by queryTracks when the per-device daily track budget is exhausted. */
export class Gps51RateLimitError extends Gps51Error {
  constructor(message: string) {
    super(message);
    this.name = "Gps51RateLimitError";
  }
}

const ERROR_MESSAGES: Record<number, string> = {
  [-1]: "GPS51 returned an exception (-1)",
  8901: "GPS51 action not found (8901)",
  8902: "GPS51 IP rate limit — max 10 requests/min (8902)",
  8903: "GPS51 account access restricted (8903)",
  8904: "GPS51 IP not whitelisted (8904) — add the server's egress IP in the GPS51 backend",
  8905: "GPS51 daily call quota exhausted (8905)",
  8906: "GPS51 action forbidden (8906)",
  9903: "GPS51 token expired (9903)",
  9906: "GPS51 token not found / logged in elsewhere (9906)",
};

function messageFor(action: string, status: number, cause?: string): string {
  return ERROR_MESSAGES[status] ?? `GPS51 ${action} failed: status ${status}${cause ? ` (${cause})` : ""}`;
}

// ---------------------------------------------------------------------------
// Config + auth
// ---------------------------------------------------------------------------
async function gps51Config(): Promise<{ username: string | null; password: string | null; baseUrl: string }> {
  const username = await getSecret("integration:gps51:username", "GPS51_USERNAME");
  const password = await getSecret("integration:gps51:password", "GPS51_PASSWORD");
  const baseUrl = (await getString("integration:gps51:baseUrl", "GPS51_BASE_URL")) ?? "https://api.gps51.com";
  return { username, password, baseUrl: baseUrl.replace(/\/+$/, "") };
}

export async function isGps51Configured(): Promise<boolean> {
  const cfg = await gps51Config();
  return Boolean(cfg.username && cfg.password);
}

function md5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex").toLowerCase();
}

type Auth = { token: string; serverid: string; baseUrl: string; username: string; expiresAt: number };
let tokenCache: Auth | null = null;

async function login(force = false): Promise<Auth> {
  const cfg = await gps51Config();
  if (!cfg.username || !cfg.password) {
    throw new Gps51Error("GPS51 is not configured (set GPS51_USERNAME / GPS51_PASSWORD)");
  }
  if (
    !force &&
    tokenCache &&
    tokenCache.expiresAt > Date.now() &&
    tokenCache.username === cfg.username &&
    tokenCache.baseUrl === cfg.baseUrl
  ) {
    return tokenCache;
  }
  const res = await fetch(`${cfg.baseUrl}/webapi?action=login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.username, password: md5(cfg.password), from: "WEB", type: "USER" }),
  });
  if (!res.ok) throw new Gps51Error(`GPS51 login HTTP ${res.status}`, undefined, "login");
  const json = (await res.json()) as { status: number; cause?: string; token?: string; serverid?: string | number };
  if (json.status !== 0 || !json.token) {
    throw new Gps51Error(messageFor("login", json.status, json.cause), json.status, "login");
  }
  tokenCache = {
    token: json.token,
    serverid: String(json.serverid ?? ""),
    baseUrl: cfg.baseUrl,
    username: cfg.username,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  log.info({ serverid: tokenCache.serverid }, "gps51: logged in");
  return tokenCache;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST an action with retry. Transient failures (network / non-2xx) back off
 * and retry; token errors (9903/9906) drop the cache and re-login; definitive
 * API errors (8904/8905/...) throw immediately without retry.
 */
async function gps51Request<T>(
  action: string,
  payload: Record<string, unknown>,
  { retry = 2 }: { retry?: number } = {},
): Promise<T> {
  let forceLogin = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const auth = await login(forceLogin);
    forceLogin = false;
    const url =
      `${auth.baseUrl}/webapi?action=${encodeURIComponent(action)}` +
      `&token=${encodeURIComponent(auth.token)}&serverid=${encodeURIComponent(auth.serverid)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        lastErr = new Gps51Error(`GPS51 ${action} HTTP ${res.status}`, undefined, action);
        if (attempt < retry) await sleep(2 ** attempt * 500);
        continue;
      }
      const json = (await res.json()) as T & { status?: number; cause?: string };
      const status = json.status ?? 0;
      if (status === 9903 || status === 9906) {
        tokenCache = null;
        forceLogin = true;
        lastErr = new Gps51Error(messageFor(action, status, json.cause), status, action);
        continue;
      }
      if (status !== 0) {
        throw new Gps51Error(messageFor(action, status, json.cause), status, action);
      }
      return json;
    } catch (err) {
      // Definitive API errors carry a status — never retry those.
      if (err instanceof Gps51Error && err.status != null) throw err;
      lastErr = err;
      if (attempt < retry) await sleep(2 ** attempt * 500);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Gps51Error(`GPS51 ${action} failed`, undefined, action);
}

// ---------------------------------------------------------------------------
// Domain calls
// ---------------------------------------------------------------------------
export interface Gps51Device {
  deviceid: string;
  devicename?: string;
  simnum?: string;
  isfree?: number; // 1 normal / 2 trial / 3 disabled / 4 due / 5 expired
  overduetime?: number;
  lastactivetime?: number;
}

export async function queryMonitorList(): Promise<Gps51Device[]> {
  const cfg = await gps51Config();
  const json = await gps51Request<{ groups?: Array<{ devices?: Gps51Device[] }> }>("querymonitorlist", {
    username: cfg.username,
  });
  return (json.groups ?? []).flatMap((g) => g.devices ?? []);
}

export interface Gps51PositionRecord {
  deviceid: string;
  devicetime?: number;
  updatetime?: number;
  callat?: number;
  callon?: number;
  speed?: number;
  course?: number;
  totaldistance?: number;
  voltagepercent?: number;
  moving?: number;
  status?: number;
  iostatus?: number;
  strstatus?: string;
  strstatusen?: string;
  radius?: number;
  [k: string]: unknown;
}

export async function lastPosition(opts: {
  deviceIds?: string[];
  cursor?: bigint | number;
}): Promise<{ records: Gps51PositionRecord[]; cursor: number }> {
  const cfg = await gps51Config();
  const json = await gps51Request<{ records?: Gps51PositionRecord[]; lastquerypositiontime?: number }>(
    "lastposition",
    {
      username: cfg.username,
      deviceids: opts.deviceIds ?? [],
      lastquerypositiontime: Number(opts.cursor ?? 0),
    },
  );
  return {
    records: json.records ?? [],
    cursor: Number(json.lastquerypositiontime ?? opts.cursor ?? 0),
  };
}

/**
 * On-demand track history for one device over a window. ENFORCES the provider's
 * 5/device/day cap via Redis and throws Gps51RateLimitError past it — callers
 * should fall back to stored telemetry. NEVER call this from a job.
 */
export async function queryTracks(opts: {
  deviceId: string;
  begin: string; // "yyyy-MM-dd HH:mm:ss" (local)
  end: string;
  tz?: number; // default Brisbane UTC+10
}): Promise<Gps51PositionRecord[]> {
  await meterTracks(opts.deviceId);
  const json = await gps51Request<{ records?: Gps51PositionRecord[] }>("querytracks", {
    deviceid: opts.deviceId,
    begintime: opts.begin,
    endtime: opts.end,
    timezone: opts.tz ?? 10,
  });
  return json.records ?? [];
}

async function meterTracks(deviceId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return; // no Redis in this context — provider still enforces the cap
  const key = `gps51:tracks:${deviceId}:${brisbaneYyyymmdd()}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, secondsUntilBrisbaneMidnight());
  if (n > TRACKS_DAILY_LIMIT) {
    await redis.decr(key); // don't count the rejected attempt
    throw new Gps51RateLimitError(`GPS51 track quota reached for device ${deviceId} (${TRACKS_DAILY_LIMIT}/day)`);
  }
}

// ---------------------------------------------------------------------------
// Continuous poll → VehicleLivePosition + VehicleTelemetry
// ---------------------------------------------------------------------------
export interface Gps51SyncResult {
  syncId: string;
  status: "SUCCESS" | "FAILED";
  devicesSeen: number;
  recordsWritten: number;
}

export async function runGps51Sync(prisma: PrismaClient = defaultPrisma): Promise<Gps51SyncResult> {
  if (!(await isGps51Configured())) throw new Gps51Error("GPS51 is not configured");

  const sync = await prisma.gps51Sync.create({ data: { status: "RUNNING" } });
  let recordsWritten = 0;
  let devicesSeen = 0;
  try {
    // Map configured device IDs → vehicles. Empty list ⇒ all account devices.
    const linked = await prisma.vehicle.findMany({
      where: { gpsTrackerId: { not: null } },
      select: { id: true, gpsTrackerId: true },
    });
    const deviceToVehicle = new Map<string, string>();
    for (const v of linked) if (v.gpsTrackerId) deviceToVehicle.set(v.gpsTrackerId, v.id);
    const deviceIds = [...deviceToVehicle.keys()];

    // Resume from the last successful cursor (server-side dedup window).
    const last = await prisma.gps51Sync.findFirst({
      where: { status: "SUCCESS", cursor: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { cursor: true },
    });
    const cursor = last?.cursor ?? 0n;

    const { records, cursor: newCursor } = await lastPosition({ deviceIds, cursor });
    devicesSeen = records.length;

    for (const rec of records) {
      const lat = num(rec.callat);
      const lon = num(rec.callon);
      if (lat == null || lon == null) continue;

      const fixAt = normaliseEpoch(rec.devicetime ?? rec.updatetime) ?? new Date();
      const vehicleId = deviceToVehicle.get(rec.deviceid) ?? null;
      const moving = rec.moving === 1 ? true : rec.moving === 0 ? false : null;
      const raw = rec as unknown as Prisma.InputJsonValue;

      // Live-map snapshot only. Full-fidelity history is owned by the nightly
      // querytracks sync (runGps51DailyTrackSync); the poll no longer appends to
      // the VehicleTelemetry hypertable.
      const common = {
        vehicleId,
        latitude: lat,
        longitude: lon,
        speedKph: speedKphFromRaw(rec.speed), // GPS51 speed is metres/hour → km/h
        headingDeg: num(rec.course),
        ignitionOn: deriveIgnition(rec),
        batteryPct: num(rec.voltagepercent),
        moving,
        timestamp: fixAt,
        raw,
      };
      await prisma.vehicleLivePosition.upsert({
        where: { deviceId: rec.deviceid },
        create: { deviceId: rec.deviceid, ...common },
        update: common,
      });
    }

    await prisma.gps51Sync.update({
      where: { id: sync.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        devicesSeen,
        recordsWritten,
        cursor: BigInt(Math.trunc(newCursor)),
      },
    });
    log.info({ devicesSeen, recordsWritten, cursor: newCursor }, "gps51: sync complete");
    return { syncId: sync.id, status: "SUCCESS", devicesSeen, recordsWritten };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.gps51Sync
      .update({
        where: { id: sync.id },
        data: { status: "FAILED", finishedAt: new Date(), devicesSeen, recordsWritten, error: message.slice(0, 500) },
      })
      .catch(() => undefined);
    log.error({ err: message }, "gps51: sync failed");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Daily full-fidelity track sync → VehicleTelemetry
// ---------------------------------------------------------------------------
export const DAILY_TRACK_SYNC_SETTING_KEY = "gps51:dailyTrackSync:lastRun";

export interface Gps51DailyTrackSyncResult {
  status: "SUCCESS" | "PARTIAL";
  devicesTotal: number;
  devicesSucceeded: number;
  recordsWritten: number;
  deviceErrors: Array<{ deviceId: string; error: string }>;
}

/**
 * Once-a-day full-track sync. For every vehicle with a tracker, pull the last
 * `hoursBack` hours via `queryTracks` and append every fix to the
 * VehicleTelemetry hypertable — the authoritative history (the live poll no
 * longer writes it). Dedup is the (deviceId, timestamp) PK via skipDuplicates,
 * and rows use the same `updatetime ?? devicetime` timestamp + `gps51-track`
 * source as on-demand manager pulls so the two never double-insert a fix.
 *
 * One pull/device/day uses 1 of the provider's 5/device/day budget. Device
 * pulls are throttled to stay under the 10-req/min single-IP cap shared with
 * the poll; a device that errors (incl. its track quota) is skipped and the run
 * degrades to PARTIAL. An account-wide quota error (8905) aborts the rest.
 */
export async function runGps51DailyTrackSync(
  prisma: PrismaClient = defaultPrisma,
  opts: { hoursBack?: number } = {},
): Promise<Gps51DailyTrackSyncResult> {
  if (!(await isGps51Configured())) throw new Gps51Error("GPS51 is not configured");

  const hoursBack = opts.hoursBack ?? 24;
  const startedAt = new Date();
  const begin = new Date(startedAt.getTime() - hoursBack * 3600 * 1000);
  const beginStr = formatBrisbaneDateTime(begin);
  const endStr = formatBrisbaneDateTime(startedAt);

  const linked = await prisma.vehicle.findMany({
    where: { gpsTrackerId: { not: null } },
    select: { id: true, gpsTrackerId: true },
  });
  const deviceToVehicle = new Map<string, string>();
  for (const v of linked) if (v.gpsTrackerId) deviceToVehicle.set(v.gpsTrackerId, v.id);
  const deviceIds = [...deviceToVehicle.keys()];

  let recordsWritten = 0;
  let devicesSucceeded = 0;
  const deviceErrors: Array<{ deviceId: string; error: string }> = [];

  for (let i = 0; i < deviceIds.length; i++) {
    const deviceId = deviceIds[i]!;
    const vehicleId = deviceToVehicle.get(deviceId) ?? null;
    try {
      const records = await queryTracks({ deviceId, begin: beginStr, end: endStr });
      const rows = records
        .filter((r) => num(r.callat) != null && num(r.callon) != null)
        .map((r) => ({
          deviceId,
          vehicleId,
          // Match the on-demand pull precedence (fleet router) so the same fix
          // never lands as two rows across the two `gps51-track` writers.
          timestamp: normaliseEpoch(r.updatetime ?? r.devicetime) ?? begin,
          latitude: r.callat as number,
          longitude: r.callon as number,
          speedKph: speedKphFromRaw(r.speed),
          headingDeg: num(r.course),
          odometerKm: r.totaldistance != null ? Number(r.totaldistance) / 1000 : null,
          batteryPct: num(r.voltagepercent),
          ignitionOn: deriveIgnition(r),
          source: "gps51-track",
          raw: r as unknown as Prisma.InputJsonValue,
        }));
      // ON CONFLICT (deviceId, timestamp) DO NOTHING. Chunked: a vehicle driving
      // all day can return thousands of fixes.
      for (let j = 0; j < rows.length; j += TELEMETRY_INSERT_CHUNK) {
        const { count } = await prisma.vehicleTelemetry.createMany({
          data: rows.slice(j, j + TELEMETRY_INSERT_CHUNK),
          skipDuplicates: true,
        });
        recordsWritten += count;
      }
      devicesSucceeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deviceErrors.push({ deviceId, error: message.slice(0, 200) });
      log.warn({ deviceId, err: message }, "gps51 daily track sync: device failed");
      // Account-wide daily quota exhausted — every remaining device would fail too.
      if (err instanceof Gps51Error && err.status === 8905) break;
    }
    if (i < deviceIds.length - 1) await sleep(DAILY_TRACK_THROTTLE_MS);
  }

  const status: "SUCCESS" | "PARTIAL" = deviceErrors.length === 0 ? "SUCCESS" : "PARTIAL";
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    hoursBack,
    devicesTotal: deviceIds.length,
    devicesSucceeded,
    recordsWritten,
    deviceErrors: deviceErrors.slice(0, DEVICE_ERROR_SAMPLE_LIMIT),
  } satisfies Record<string, unknown>;

  // Run summary lives in SystemSetting, not Gps51Sync (the 1-min poll owns that
  // table and its cursor) — no schema change, and the BullMQ worker wrapper
  // already writes per-run JOB audit rows + Sentry check-ins. Best-effort.
  await prisma.systemSetting
    .upsert({
      where: { key: DAILY_TRACK_SYNC_SETTING_KEY },
      create: {
        key: DAILY_TRACK_SYNC_SETTING_KEY,
        value: summary as Prisma.InputJsonValue,
        group: "gps51",
        description: "Last daily GPS51 full-track sync run",
      },
      update: { value: summary as Prisma.InputJsonValue },
    })
    .catch((err: unknown) =>
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "gps51 daily track sync: summary write failed"),
    );

  log.info(
    { devicesTotal: deviceIds.length, devicesSucceeded, recordsWritten, status },
    "gps51 daily track sync complete",
  );
  return { status, devicesTotal: deviceIds.length, devicesSucceeded, recordsWritten, deviceErrors };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** GPS51 reports `speed` in metres/hour — the same metres convention as
 *  `totaldistance` (which we already divide by 1000 for km). Divide by 1000 to
 *  get km/h. The original value is preserved in the stored `raw.speed`, so the
 *  one-off backfill (scripts/backfill-telemetry-speed-units.ts) can re-derive it. */
export function speedKphFromRaw(rawSpeed: unknown): number | null {
  const n = num(rawSpeed);
  return n == null ? null : n / 1000;
}

/** GPS51 epochs are `long` with no documented unit — auto-detect s vs ms. */
export function normaliseEpoch(epoch: number | null | undefined): Date | null {
  if (epoch == null || epoch === 0) return null;
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Best-effort ignition from status text. VERIFY: map status/iostatus bit on first live response. */
export function deriveIgnition(rec: Pick<Gps51PositionRecord, "strstatus" | "strstatusen">): boolean | null {
  const s = `${rec.strstatus ?? ""} ${rec.strstatusen ?? ""}`.toLowerCase();
  if (/acc[^a-z]*(on|开)/.test(s) || /ignition[^a-z]*on/.test(s)) return true;
  if (/acc[^a-z]*(off|关)/.test(s) || /ignition[^a-z]*off/.test(s)) return false;
  return null;
}

/** Supply voltage (volts) from the GPS51 status text, e.g. "ACC Off 1H25M/Voltage 12.5V"
 *  or the Chinese "电压 12.5V". Hardwired vehicle trackers report a meaningful supply
 *  voltage here while `voltagepercent`/`voltagev` are commonly 0, so this is the reading
 *  to surface for fleet health. Returns null when no voltage is present in the status. */
export function parseStatusVoltage(
  rec: Pick<Gps51PositionRecord, "strstatus" | "strstatusen">,
): number | null {
  const s = `${rec.strstatusen ?? ""} ${rec.strstatus ?? ""}`;
  const m = s.match(/(?:voltage|电压)\s*([\d.]+)\s*v/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Brisbane day helpers (cron TZ convention; UTC+10, no DST)
// ---------------------------------------------------------------------------
function brisbaneNow(): Date {
  return new Date(Date.now() + 10 * 3600 * 1000);
}

/** Format a Date as "yyyy-MM-dd HH:mm:ss" in Brisbane local time (UTC+10) for
 *  the GPS51 querytracks window (timezone arg = 10). Mirrors the formatter in
 *  the fleet router so on-demand and nightly pulls share one window convention. */
export function formatBrisbaneDateTime(d: Date): string {
  const b = new Date(d.getTime() + 10 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}:${p(b.getUTCSeconds())}`;
}
function brisbaneYyyymmdd(): string {
  const d = brisbaneNow();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
function secondsUntilBrisbaneMidnight(): number {
  const d = brisbaneNow();
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  return Math.max(60, Math.ceil((next - d.getTime()) / 1000));
}
