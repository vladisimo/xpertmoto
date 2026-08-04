import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake Redis keyed by string; captures TTL for assertions.
const store = new Map<string, string>();
let lastTtl: number | null = null;
const redis = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string, _ex: string, ttl: number) => {
    store.set(k, v);
    lastTtl = ttl;
    return "OK";
  }),
};
let redisEnabled = true;
vi.mock("@/lib/redis", () => ({ getRedis: () => (redisEnabled ? redis : null) }));

import {
  readLiveLocationsCache,
  writeLiveLocationsCache,
} from "@/server/services/gps51-live-cache";

beforeEach(() => {
  store.clear();
  lastTtl = null;
  redisEnabled = true;
  vi.clearAllMocks();
});

describe("gps51 live-locations cache", () => {
  it("round-trips a payload and preserves Date via superjson", async () => {
    const ts = new Date("2026-07-05T12:00:00Z");
    await writeLiveLocationsCache([{ deviceId: "d1", timestamp: ts }]);
    expect(lastTtl).toBe(10); // short TTL, well inside the 60s poll

    const got = await readLiveLocationsCache<Array<{ deviceId: string; timestamp: Date }>>();
    expect(got).not.toBeNull();
    expect(got![0]!.timestamp).toBeInstanceOf(Date);
    expect(got![0]!.timestamp.getTime()).toBe(ts.getTime());
  });

  it("returns null on a miss and when Redis is unavailable", async () => {
    expect(await readLiveLocationsCache()).toBeNull();
    redisEnabled = false;
    await writeLiveLocationsCache([{ any: "thing" }]); // no throw
    expect(await readLiveLocationsCache()).toBeNull();
  });
});
