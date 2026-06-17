import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSecret = vi.fn();
const getString = vi.fn();
vi.mock("@/lib/integration-config", () => ({
  getSecret: (...a: unknown[]) => getSecret(...a),
  getString: (...a: unknown[]) => getString(...a),
}));
// No Redis in unit context → meterTracks no-ops (provider still enforces the cap).
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));

import type { PrismaClient } from "@prisma/client";
import {
  lastPosition,
  runGps51DailyTrackSync,
  normaliseEpoch,
  deriveIgnition,
  parseStatusVoltage,
  speedKphFromRaw,
  num,
} from "@/server/services/gps51";

type Json = Record<string, unknown>;
const ok = (body: Json) => ({ ok: true, status: 200, json: async () => body });

// Dispatch fetch by the `action` query param so tests are order-independent
// (the service caches its login token at module scope).
function mockFetch(byAction: Record<string, Json>) {
  return vi.fn(async (url: string) => {
    const action = new URL(url).searchParams.get("action") ?? "";
    const body = byAction[action];
    if (!body) throw new Error(`unexpected action: ${action}`);
    return ok(body) as unknown as Response;
  });
}

beforeEach(() => {
  getSecret.mockImplementation(async (key: string) =>
    key.includes("username") ? "xpertmoto" : "secret-pw",
  );
  getString.mockResolvedValue("https://api.test");
});
afterEach(() => vi.restoreAllMocks());

describe("lastPosition", () => {
  it("logs in then queries, sending token+serverid and parsing records+cursor", async () => {
    const fetchMock = mockFetch({
      login: { status: 0, token: "tok-abc", serverid: 7 },
      lastposition: {
        status: 0,
        lastquerypositiontime: 1718450000000,
        records: [{ deviceid: "19210047052", callat: -27.4, callon: 153.0, speed: 42, course: 90 }],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { records, cursor } = await lastPosition({ deviceIds: ["19210047052"], cursor: 0 });

    expect(records).toHaveLength(1);
    expect(records[0]!.callat).toBe(-27.4);
    expect(cursor).toBe(1718450000000);

    const lastCall = fetchMock.mock.calls.at(-1)![0] as string;
    expect(lastCall).toContain("action=lastposition");
    expect(lastCall).toContain("token=tok-abc");
    expect(lastCall).toContain("serverid=7");
  });

  it("throws a typed Gps51Error on a definitive API status (8904 not whitelisted)", async () => {
    vi.stubGlobal("fetch", mockFetch({ lastposition: { status: 8904, cause: "ip" } }) as unknown as typeof fetch);
    await expect(lastPosition({ deviceIds: ["x"] })).rejects.toMatchObject({
      name: "Gps51Error",
      status: 8904,
    });
  });
});

describe("normaliseEpoch", () => {
  it("returns null for 0/undefined", () => {
    expect(normaliseEpoch(0)).toBeNull();
    expect(normaliseEpoch(undefined)).toBeNull();
  });
  it("treats values < 1e12 as seconds and >= 1e12 as milliseconds", () => {
    expect(normaliseEpoch(1_718_450_000)!.getTime()).toBe(1_718_450_000_000);
    expect(normaliseEpoch(1_718_450_000_000)!.getTime()).toBe(1_718_450_000_000);
  });
});

describe("deriveIgnition", () => {
  it("reads ACC on/off from status text, null when unknown", () => {
    expect(deriveIgnition({ strstatusen: "ACC ON, moving" })).toBe(true);
    expect(deriveIgnition({ strstatus: "ACC关" })).toBe(false);
    expect(deriveIgnition({ strstatus: "GPS located" })).toBeNull();
  });
});

describe("parseStatusVoltage", () => {
  it("reads supply voltage from the English status text", () => {
    expect(parseStatusVoltage({ strstatusen: "ACC Off 1H25M/Voltage 12.5V" })).toBe(12.5);
  });
  it("reads supply voltage from the Chinese status text", () => {
    expect(parseStatusVoltage({ strstatus: "ACC关 1时25分/电压 12.5V" })).toBe(12.5);
  });
  it("returns null when no voltage is present", () => {
    expect(parseStatusVoltage({ strstatusen: "ACC On, moving" })).toBeNull();
    expect(parseStatusVoltage({})).toBeNull();
  });
});

describe("num", () => {
  it("passes finite numbers and rejects everything else", () => {
    expect(num(42)).toBe(42);
    expect(num("42")).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(undefined)).toBeNull();
  });
});

describe("speedKphFromRaw", () => {
  it("converts GPS51 metres/hour to km/h", () => {
    expect(speedKphFromRaw(44_400)).toBeCloseTo(44.4);
    expect(speedKphFromRaw(0)).toBe(0);
  });
  it("returns null for missing / non-numeric speed", () => {
    expect(speedKphFromRaw(null)).toBeNull();
    expect(speedKphFromRaw(undefined)).toBeNull();
    expect(speedKphFromRaw("44400")).toBeNull();
  });
});

describe("runGps51DailyTrackSync", () => {
  function mockPrisma(over: { devices?: Array<{ id: string; gpsTrackerId: string }> } = {}) {
    const createMany = vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length }));
    const upsert = vi.fn(async () => ({}));
    const findMany = vi.fn(async () =>
      over.devices ?? [{ id: "veh1", gpsTrackerId: "dev1" }],
    );
    const prisma = {
      vehicle: { findMany },
      vehicleTelemetry: { createMany },
      systemSetting: { upsert },
    } as unknown as PrismaClient;
    return { prisma, createMany, upsert, findMany };
  }

  it("pulls querytracks per device and appends deduped gps51-track rows", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        login: { status: 0, token: "tok-abc", serverid: 7 },
        querytracks: {
          status: 0,
          records: [
            {
              deviceid: "dev1",
              updatetime: 1_718_450_000,
              devicetime: 1_718_449_000,
              callat: -27.4,
              callon: 153.0,
              speed: 30_000, // GPS51 metres/hour → 30 km/h
              course: 90,
              totaldistance: 12_000,
              voltagepercent: 80,
              strstatusen: "ACC ON",
            },
            { deviceid: "dev1", callat: null, callon: 153.0 }, // no fix → filtered out
          ],
        },
      }) as unknown as typeof fetch,
    );
    const { prisma, createMany, upsert } = mockPrisma();

    const res = await runGps51DailyTrackSync(prisma, { hoursBack: 24 });

    expect(res.status).toBe("SUCCESS");
    expect(res.devicesTotal).toBe(1);
    expect(res.devicesSucceeded).toBe(1);
    expect(res.recordsWritten).toBe(1);

    const args = createMany.mock.calls[0]![0] as {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    };
    expect(args.skipDuplicates).toBe(true);
    expect(args.data[0]).toMatchObject({
      deviceId: "dev1",
      vehicleId: "veh1",
      source: "gps51-track",
      latitude: -27.4,
      longitude: 153.0,
      odometerKm: 12,
      speedKph: 30, // 30_000 metres/hour ÷ 1000
    });
    // timestamp prefers updatetime (matches the on-demand pull precedence)
    expect((args.data[0]!.timestamp as Date).getTime()).toBe(1_718_450_000 * 1000);
    expect(upsert).toHaveBeenCalledTimes(1); // run summary persisted
  });

  it("degrades to PARTIAL and records the error when a device pull fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        login: { status: 0, token: "tok-abc", serverid: 7 },
        querytracks: { status: 8902, cause: "rate" }, // IP rate limit → throws per device
      }) as unknown as typeof fetch,
    );
    const { prisma, createMany, upsert } = mockPrisma();

    const res = await runGps51DailyTrackSync(prisma);

    expect(res.status).toBe("PARTIAL");
    expect(res.devicesSucceeded).toBe(0);
    expect(res.deviceErrors).toHaveLength(1);
    expect(res.deviceErrors[0]!.deviceId).toBe("dev1");
    expect(createMany).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1); // summary still written
  });
});
