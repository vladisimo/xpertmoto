import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory ioredis stand-in: just enough surface for cached()/invalidate*.
function makeRedis() {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const sets = new Map<string, Set<string>>();
  const calls: string[][] = [];

  const api = {
    get: vi.fn(async (k: string) => strings.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      strings.set(k, v);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (strings.delete(k)) n++;
        if (zsets.delete(k)) n++;
        if (sets.delete(k)) n++;
      }
      return n;
    }),
    zadd: vi.fn(async (k: string, score: number, member: string) => {
      const z = zsets.get(k) ?? new Map<string, number>();
      z.set(member, score);
      zsets.set(k, z);
      return 1;
    }),
    zremrangebyscore: vi.fn(async (k: string, min: number, max: number) => {
      const z = zsets.get(k);
      if (!z) return 0;
      let n = 0;
      for (const [member, score] of z) {
        if (score >= min && score <= max) {
          z.delete(member);
          n++;
        }
      }
      return n;
    }),
    zrange: vi.fn(async (k: string) => [...(zsets.get(k)?.keys() ?? [])]),
    smembers: vi.fn(async (k: string) => [...(sets.get(k) ?? [])]),
    expire: vi.fn(async () => 1),
    pipeline() {
      const queued: Array<() => Promise<unknown>> = [];
      const p = {
        zadd: (...a: [string, number, string]) => {
          calls.push(["zadd", a[0]]);
          queued.push(() => api.zadd(...a));
          return p;
        },
        zremrangebyscore: (...a: [string, number, number]) => {
          calls.push(["zremrangebyscore", a[0]]);
          queued.push(() => api.zremrangebyscore(...a));
          return p;
        },
        expire: (...a: [string, number]) => {
          calls.push(["expire", a[0]]);
          queued.push(() => api.expire());
          return p;
        },
        exec: async () => {
          for (const fn of queued) await fn();
          return [];
        },
      };
      return p;
    },
    _strings: strings,
    _zsets: zsets,
    _sets: sets,
    _calls: calls,
  };
  return api;
}

let redis: ReturnType<typeof makeRedis>;
vi.mock("@/lib/redis", () => ({
  getRedis: () => redis,
}));

import { cached, invalidateTag } from "@/lib/cache";

beforeEach(() => {
  redis = makeRedis();
  vi.clearAllMocks();
});

describe("cached() tag index", () => {
  it("indexes the key in a sorted set scored by expiry and prunes expired members on write", async () => {
    // Pre-seed a dead member: its score is in the past, its key is gone.
    redis._zsets.set("tagz:availability", new Map([["stale-key", Date.now() - 1000]]));

    await cached("fresh-key", 60, async () => ({ ok: true }), ["availability"]);

    const index = redis._zsets.get("tagz:availability")!;
    expect(index.has("fresh-key")).toBe(true);
    expect(index.get("fresh-key")).toBeGreaterThan(Date.now());
    // The dead member was shed by the same write — the index self-prunes.
    expect(index.has("stale-key")).toBe(false);
  });

  it("returns the cached value without re-running fn on a hit", async () => {
    const fn = vi.fn(async () => "v1");
    await cached("k", 60, fn, ["t"]);
    const second = await cached("k", 60, fn, ["t"]);
    expect(second).toBe("v1");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateTag()", () => {
  it("drops every indexed key plus the index itself", async () => {
    await cached("k1", 60, async () => 1, ["t"]);
    await cached("k2", 60, async () => 2, ["t"]);

    await invalidateTag("t");

    expect(redis._strings.has("k1")).toBe(false);
    expect(redis._strings.has("k2")).toBe(false);
    expect(redis._zsets.has("tagz:t")).toBe(false);
  });

  it("also drains legacy plain-SET indexes written before the zset change", async () => {
    redis._sets.set("tagset:t", new Set(["old-key"]));
    redis._strings.set("old-key", "x");

    await invalidateTag("t");

    expect(redis._strings.has("old-key")).toBe(false);
    expect(redis._sets.has("tagset:t")).toBe(false);
  });
});
