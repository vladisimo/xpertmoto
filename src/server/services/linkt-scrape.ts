/**
 * Linkt (Transurban) portal scraper — the automatic alternative to the staff
 * CSV/Excel upload. Its ONLY job is to produce the trip-export file as a Buffer
 * and hand it to `runLinktSync(prisma, accountId, {buffer})`; parsing, matching,
 * infringement-raising and charging all live in `linkt.ts` and are untouched.
 *
 * Why this is hard: the Linkt portal sits behind Imperva Incapsula
 * bot-mitigation that blocks plain headless browsers — which is exactly why the
 * predecessor scraper was dropped in favour of manual upload. This module's only
 * value-add over a naive `chromium.launch()` is the anti-detection layer:
 *   - a PERSISTENT browser context per account, so a once-cleared Incapsula
 *     challenge (its `visid_incap_*` / `incap_ses_*` cookies) survives between
 *     runs — this is what makes the "occasional manual re-auth" model viable;
 *   - a realistic fingerprint (UA / locale / timezone / viewport), masked
 *     `navigator.webdriver`, and the automation-controlled blink flag off;
 *   - an optional residential proxy (`LINKT_PROXY_URL`) — datacenter worker IPs
 *     are the single biggest Incapsula red flag.
 *
 * None of this GUARANTEES beating Incapsula. When the bot is blocked the run
 * fails cleanly: it records a FAILED sync, flags the account for re-auth, and
 * notifies staff — the manual CSV upload path stays the always-available
 * fallback.
 *
 * PROVISIONAL: the login selectors, the trips-page navigation, the date-range
 * controls and the export trigger below are best-effort and MUST be reconciled
 * against the real portal via the `scripts/linkt-recon.ts` feasibility spike
 * before this is trusted in production.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { type LinktAccount, type PrismaClient } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { runLinktSync } from "./linkt";

export class LinktAuthError extends Error {}
export class LinktBlockedError extends Error {}
export class LinktDownloadError extends Error {}

const DEBUG_DIR = path.resolve(process.cwd(), "tmp", "linkt-debug");
const SESSION_ROOT = path.resolve(process.cwd(), "tmp", "linkt-sessions");
const TRIPS_PATH = "/my-account/trips-financial-history";

// A realistic desktop-Chrome UA. Keep the major version roughly in step with the
// Chromium that actually launches; a stale UA is itself a bot tell.
const STEALTH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

export type ProxyConfig = { server: string; username?: string; password?: string };

/**
 * Parse `LINKT_PROXY_URL` (e.g. `http://user:pass@host:port`) into Playwright's
 * proxy shape. Credentials are split out because Playwright wants them as
 * separate fields, not embedded in `server`.
 */
export function parseProxy(raw: string | undefined): ProxyConfig | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return { server: raw.trim() };
  }
}

// ---------------------------------------------------------------------------
// Launch (shared with the recon spike)
// ---------------------------------------------------------------------------

export type LaunchOpts = { accountId: string; headless?: boolean; slowMo?: number };

/**
 * Launch a stealth, persistent Chromium context keyed to one Linkt account.
 * The persistent `userDataDir` is the keystone: it carries the Incapsula
 * clearance cookies forward so subsequent runs aren't re-challenged.
 */
export async function launchLinktContext(opts: LaunchOpts): Promise<BrowserContext> {
  const userDataDir = path.join(SESSION_ROOT, opts.accountId.replace(/[^a-z0-9-]/gi, "_"));
  fs.mkdirSync(userDataDir, { recursive: true });

  const proxy = parseProxy(process.env.LINKT_PROXY_URL);
  // On alpine the npm package ships no browser; the worker image installs the
  // system Chromium and points us at it. Unset locally → Playwright's bundled
  // Chromium is used.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: opts.headless ?? true,
    slowMo: opts.slowMo,
    executablePath,
    acceptDownloads: true,
    userAgent: STEALTH_UA,
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    viewport: { width: 1366, height: 900 },
    ...(proxy ? { proxy } : {}),
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  // Mask the most obvious headless tell before any page script runs.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  return context;
}

// ---------------------------------------------------------------------------
// Failure classification (pure — unit tested)
// ---------------------------------------------------------------------------

export type ScrapeFailureSignals = {
  url: string;
  bodyText: string;
  html: string;
  toastText?: string | null;
};
export type ScrapeFailureKind = "blocked" | "auth" | "unknown";

/**
 * Decide WHY we didn't reach the logged-in trips page. Incapsula markers win
 * (the bot was blocked → re-auth needed); a server-side login-error toast means
 * bad/changed credentials; otherwise we just didn't get there.
 */
export function classifyScrapeFailure(s: ScrapeFailureSignals): {
  kind: ScrapeFailureKind;
  reason: string;
} {
  const hay = `${s.bodyText}\n${s.html}`;
  if (
    /_Incapsula_Resource/i.test(s.html) ||
    /\bincapsula\b/i.test(hay) ||
    /request unsuccessful/i.test(hay) ||
    /are you a (human|robot)/i.test(hay) ||
    /unusual traffic|verify you are (a )?human|access denied|please enable (js|javascript)/i.test(hay)
  ) {
    return { kind: "blocked", reason: "Incapsula bot-mitigation challenge" };
  }
  if (s.toastText && s.toastText.trim()) {
    return { kind: "auth", reason: `Login rejected: ${s.toastText.trim()}` };
  }
  return { kind: "unknown", reason: `Did not reach the logged-in trips page (url=${s.url})` };
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function dumpPage(page: Page, label: string): Promise<string> {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(DEBUG_DIR, `${stamp}-${label}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    fs.writeFileSync(`${base}.html`, await page.content().catch(() => ""));
    return base;
  } catch {
    return "";
  }
}

/** Snapshot the page, classify the failure, and throw the matching error. */
async function failFromPage(page: Page, label: string): Promise<never> {
  const base = await dumpPage(page, label);
  const bodyText = await page.innerText("body").catch(() => "");
  const html = await page.content().catch(() => "");
  const toastText = await page
    .$eval(
      ".Toastify__toast--error, .Toastify__toast--warning, [role='alert'], .error-message, .Mui-error",
      (el) => el.textContent?.trim() ?? "",
    )
    .catch(() => "");
  const { kind, reason } = classifyScrapeFailure({ url: page.url(), bodyText, html, toastText });
  const detail = base ? `${reason} (debug: ${base})` : reason;
  if (kind === "blocked") throw new LinktBlockedError(detail);
  throw new LinktAuthError(detail);
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const sel =
    'button:has-text("Accept"), button:has-text("I accept"), button:has-text("OK"), ' +
    '#onetrust-accept-btn-handler, [aria-label*="accept" i]';
  await page.click(sel, { timeout: 2000 }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Direct export API (preferred)
// ---------------------------------------------------------------------------

const DXAPI_BASE = "https://dxapi.linkt.com.au";
// How far back the export reaches. Idempotent (externalHash), so generous
// overlap between daily runs is harmless; the server caps results at limit=1000.
const EXPORT_LOOKBACK_DAYS = Number(process.env.LINKT_EXPORT_LOOKBACK_DAYS) || 120;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Authenticated dxapi session sniffed from the SPA's own requests. */
type ApiSession = { bearer: string; acct: string; agr: string };

/**
 * Drive Linkt's export API directly (no modal): start the server-side export
 * job, poll it, and download the CSV — reusing the browser context's cookies +
 * the Bearer token the SPA already obtained. Far less brittle than clicking the
 * shadow-DOM export modal. Endpoints/flow confirmed via the recon spike:
 *   GET …/agreements/{agr}/history/export?…&format=csv → { exportKey }
 *   GET …/export/{key}/checkStatus  (poll until it leaves IN_PROGRESS)
 *   GET …/export/{key}/download     → text/csv
 */
async function exportViaApi(context: BrowserContext, session: ApiSession): Promise<Buffer> {
  const headers = { authorization: `Bearer ${session.bearer}`, accept: "application/json" };
  const api = context.request; // shares the context's cookies + fingerprint

  const end = new Date();
  const start = new Date(end.getTime() - EXPORT_LOOKBACK_DAYS * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    data: "trips,adjustments,payments,status",
    limit: "1000",
    startDate: ymd(start),
    endDate: ymd(end),
    format: "csv",
  });

  const createResp = await api.get(
    `${DXAPI_BASE}/v1/accounts/${session.acct}/agreements/${session.agr}/history/export?${qs.toString()}`,
    { headers },
  );
  if (!createResp.ok()) {
    throw new LinktDownloadError(`export create failed (HTTP ${createResp.status()})`);
  }
  const created = (await createResp.json().catch(() => ({}))) as { exportKey?: string };
  if (!created.exportKey) throw new LinktDownloadError("export create returned no exportKey");

  const statusUrl = `${DXAPI_BASE}/v1/accounts/${session.acct}/export/${created.exportKey}/checkStatus`;
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    const st = await api.get(statusUrl, { headers });
    if (st.ok()) {
      const j = (await st.json().catch(() => ({}))) as { status?: { mnemonic?: string } };
      const mn = (j.status?.mnemonic ?? "").toUpperCase();
      if (mn && mn !== "IN_PROGRESS") {
        if (/FAIL|ERROR|TOO_MANY/.test(mn)) throw new LinktDownloadError(`export job: ${mn}`);
        ready = true;
        break;
      }
    }
    await sleep(1000);
  }
  if (!ready) throw new LinktDownloadError("export job did not complete in time");

  const dl = await api.get(
    `${DXAPI_BASE}/v1/accounts/${session.acct}/export/${created.exportKey}/download`,
    { headers },
  );
  if (!dl.ok()) throw new LinktDownloadError(`export download failed (HTTP ${dl.status()})`);
  const buf = Buffer.from(await dl.body());
  if (buf.length === 0) throw new LinktDownloadError("export download was empty");
  return buf;
}

// ---------------------------------------------------------------------------
// Export modal (fallback)
// ---------------------------------------------------------------------------

/**
 * Fallback when the API session can't be captured: drive the on-page export
 * modal — "Export" → "Export as CSV" → wait for the browser download.
 */
async function exportViaModal(page: Page): Promise<Buffer> {
  const exportTrigger = page.getByRole("button", { name: /^\s*export\s*$/i }).first();
  try {
    await exportTrigger.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    await dumpPage(page, "no-export-btn");
    throw new LinktDownloadError("Export control not found on the trips page");
  }
  await exportTrigger.click();

  const csvBtn = page.getByRole("button", { name: /csv/i }).first();
  try {
    await csvBtn.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    await dumpPage(page, "no-csv-export");
    throw new LinktDownloadError("CSV export option not found in the export modal");
  }

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    csvBtn.click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new LinktDownloadError("Empty download stream");
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  if (buf.length === 0) throw new LinktDownloadError("Downloaded an empty export file");
  return buf;
}

// ---------------------------------------------------------------------------
// Scrape (login in the browser, then export via API → modal fallback)
// ---------------------------------------------------------------------------

/**
 * Log into the Linkt portal and return the trip-export CSV as a Buffer. The
 * browser is used only for login (Incapsula clearance + OAuth token); the
 * export itself goes through the direct API when the session is captured,
 * falling back to the on-page modal otherwise. Throws LinktBlockedError /
 * LinktAuthError / LinktDownloadError on failure.
 */
export async function scrapeLinktExport(account: LinktAccount): Promise<Buffer> {
  const password = decryptSecret({
    enc: account.passwordEnc,
    iv: account.passwordIv,
    tag: account.passwordTag,
  });

  const context = await launchLinktContext({ accountId: account.id });
  try {
    const page = context.pages()[0] ?? (await context.newPage());

    // Sniff the SPA's authenticated dxapi session (Bearer token + account /
    // agreement ids) off its own requests so we can drive the export API.
    const session: Partial<ApiSession> = {};
    page.on("request", (req) => {
      const u = req.url();
      if (!/dxapi\.linkt\.com\.au/i.test(u)) return;
      const auth = req.headers()["authorization"];
      if (auth && /^bearer /i.test(auth)) session.bearer = auth.replace(/^bearer\s+/i, "");
      const m = u.match(/\/accounts\/(\d+)\/agreements\/(\d+)\b/);
      if (m) {
        session.acct = m[1];
        session.agr = m[2];
      }
    });

    await page.goto(account.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await dismissCookieBanner(page);

    // Bail early if Incapsula challenged the login page itself.
    {
      const html = await page.content().catch(() => "");
      const bodyText = await page.innerText("body").catch(() => "");
      if (classifyScrapeFailure({ url: page.url(), bodyText, html }).kind === "blocked") {
        await failFromPage(page, "login-blocked");
      }
    }

    // --- Login form ---------------------------------------------------------
    // Linkt is a TWO-STEP MUI login: Username → "Next" → Password → "Log in".
    // BOTH steps share the same submit button (data-testid="usernameCheck-submit";
    // its label changes from "Next" to "Log in"), so we click the same selector
    // twice. Selectors confirmed via the recon spike against the live portal.
    const SUBMIT = 'button[data-testid="usernameCheck-submit"]';

    const userLoc = page.locator('#loginForm-username-field, input[name="username"]').first();
    try {
      await userLoc.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      await failFromPage(page, "login-no-username");
    }
    await userLoc.click();
    await userLoc.pressSequentially(account.username, { delay: 25 });
    await page.locator(SUBMIT).first().click();

    // A still-valid persisted session can skip the password step entirely and
    // jump straight to /my-account, so the password step is best-effort: fill it
    // when it appears; otherwise require that we've actually left the login flow.
    const onLogin = (u: string) => /\/(my-)?login/i.test(u);
    const passLoc = page.locator('#password, input[name="password"], input[type="password"]').first();
    await passLoc.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    if (await passLoc.isVisible().catch(() => false)) {
      await passLoc.click();
      await passLoc.pressSequentially(password, { delay: 25 });
      await dismissCookieBanner(page);
      await page.locator(SUBMIT).first().click();
    } else if (onLogin(page.url())) {
      await failFromPage(page, "login-no-password");
    }

    // Wait for the SPA to leave the login flow, then navigate to the trips page
    // and confirm we weren't bounced back.
    await page.waitForURL((u) => !onLogin(u.toString()), { timeout: 30_000 }).catch(() => {});
    if (onLogin(page.url())) {
      await failFromPage(page, "login-stuck");
    }
    const tripsUrl = new URL(TRIPS_PATH, account.loginUrl).toString();
    await page.goto(tripsUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    if (onLogin(page.url())) {
      await failFromPage(page, "login-stuck");
    }
    // Incapsula can re-challenge after login, too.
    {
      const html = await page.content().catch(() => "");
      const bodyText = await page.innerText("body").catch(() => "");
      if (classifyScrapeFailure({ url: page.url(), bodyText, html }).kind === "blocked") {
        await failFromPage(page, "trips-blocked");
      }
    }
    await dismissCookieBanner(page);

    // Give the SPA a moment to fire its dxapi calls so we capture the session.
    for (let i = 0; i < 30 && !(session.bearer && session.acct && session.agr); i++) {
      await page.waitForTimeout(500);
    }

    // --- Export: direct API preferred, on-page modal as fallback ------------
    let buf: Buffer;
    if (session.bearer && session.acct && session.agr) {
      try {
        buf = await exportViaApi(context, session as ApiSession);
      } catch (e) {
        logger.warn(
          { accountId: account.id, err: e instanceof Error ? e.message : String(e) },
          "Linkt API export failed — falling back to the export modal",
        );
        buf = await exportViaModal(page);
      }
    } else {
      logger.warn(
        { accountId: account.id },
        "Linkt API session not captured — using the export modal",
      );
      buf = await exportViaModal(page);
    }

    // Persist the latest download for diagnosis (one file per account).
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const safe = account.id.replace(/[^a-z0-9-]/gi, "_");
      fs.writeFileSync(path.join(DEBUG_DIR, `latest-${safe}.csv`), buf);
    } catch {
      // Non-fatal.
    }

    return buf;
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Orchestration: scrape → existing source-agnostic pipeline
// ---------------------------------------------------------------------------

/**
 * Scrape the export for one account and feed it through the normal
 * `runLinktSync` pipeline. On a clean scrape failure: records a FAILED sync,
 * flags re-auth (for blocked/auth failures), notifies staff, and re-throws.
 */
export async function runLinktScrape(
  prisma: PrismaClient,
  accountId: string,
): Promise<{ syncId: string; status: string }> {
  const account = await prisma.linktAccount.findUniqueOrThrow({ where: { id: accountId } });

  let buffer: Buffer;
  try {
    buffer = await scrapeLinktExport(account);
  } catch (e) {
    const needsReauth = e instanceof LinktBlockedError || e instanceof LinktAuthError;
    const msg = e instanceof Error ? e.message : String(e);
    await recordScrapeFailure(prisma, account, msg, needsReauth);
    throw e;
  }

  // We got in — clear any stale re-auth flag before running the normal pipeline.
  await prisma.linktAccount.update({ where: { id: accountId }, data: { reauthNeededAt: null } });
  return runLinktSync(prisma, accountId, { buffer });
}

async function recordScrapeFailure(
  prisma: PrismaClient,
  account: LinktAccount,
  message: string,
  needsReauth: boolean,
): Promise<void> {
  const error = `scrape: ${message}`.slice(0, 1000);
  const now = new Date();

  const lastSuccess = await prisma.linktSync.findFirst({
    where: { accountId: account.id, status: "SUCCESS" },
    orderBy: { finishedAt: "desc" },
  });

  await prisma.linktSync.create({
    data: {
      accountId: account.id,
      status: "FAILED",
      finishedAt: now,
      periodFrom: lastSuccess?.periodTo ?? new Date("2000-01-01"),
      periodTo: now,
      error,
    },
  });

  await prisma.linktAccount.update({
    where: { id: account.id },
    data: {
      lastSyncAt: now,
      lastSyncStatus: "FAILED",
      lastSyncError: error,
      ...(needsReauth ? { reauthNeededAt: now } : {}),
    },
  });

  logger.warn({ accountId: account.id, needsReauth }, "Linkt scrape failed");

  if (needsReauth) {
    await notifyLinktReauth(prisma, account, message).catch((e) =>
      logger.warn(
        { accountId: account.id, err: e instanceof Error ? e.message : String(e) },
        "Linkt re-auth notification failed",
      ),
    );
  }
}

/**
 * Notify back-office staff that the Linkt scraper is blocked and needs a manual
 * re-login (or a manual CSV upload). Mirrors the maintenance-alert pattern:
 * IN_APP, deduped by a synthetic `data.key`, fanned to active back-office users.
 */
async function notifyLinktReauth(
  prisma: PrismaClient,
  account: LinktAccount,
  reason: string,
): Promise<void> {
  const now = new Date();
  const key = `linkt.reauth.${account.id}.${now.toISOString().slice(0, 10)}`;

  const exists = await prisma.notification.findFirst({
    where: { type: "CUSTOM", data: { path: ["key"], equals: key } },
  });
  if (exists) return;

  const recipients = await prisma.user.findMany({
    where: { role: { in: ["STAFF", "MANAGER", "ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
  });

  const title = `Linkt auto-sync needs attention — ${account.name}`;
  const body =
    `Automatic Linkt toll syncing was blocked (${reason}). ` +
    `Open Admin → Integrations → Tolls and use "Scrape now" to retry, or upload the ` +
    `CSV/Excel trip export manually. Account: ${account.name} (${account.region}).`;

  for (const r of recipients) {
    await prisma.notification.create({
      data: {
        userId: r.id,
        type: "CUSTOM",
        category: "OPERATIONAL",
        channel: "IN_APP",
        title,
        body,
        data: { key, accountId: account.id, kind: "linkt-reauth" },
        status: "SENT",
        sentAt: now,
      },
    });
  }
}
