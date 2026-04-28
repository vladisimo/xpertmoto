import { describe, expect, test, beforeEach, vi } from "vitest";

vi.mock("@/lib/redis", () => ({ getRedis: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { rateLimit } from "@/lib/rate-limit";
import { getRedis } from "@/lib/redis";

type FakeClient = {
  defineCommand: ReturnType<typeof vi.fn>;
  scooteringSlidingRateLimit?: ReturnType<typeof vi.fn>;
};

function makeFake(impl: (count: number) => [number, number, number]): FakeClient {
  let count = 0;
  const fake: FakeClient = {
    defineCommand: vi.fn(function (this: FakeClient, name: string) {
      this[name as "scooteringSlidingRateLimit"] = vi.fn(async () => {
        count += 1;
        return impl(count);
      });
    }),
  };
  return fake;
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.mocked(getRedis).mockReset();
  });

  test("allows within limit then denies", async () => {
    const fake = makeFake((n) => (n <= 3 ? [1, 3 - n, Date.now() + 60_000] : [0, 0, Date.now() + 60_000]));
    vi.mocked(getRedis).mockReturnValue(fake as never);

    const r1 = await rateLimit("test", 3, 60);
    const r2 = await rateLimit("test", 3, 60);
    const r3 = await rateLimit("test", 3, 60);
    const r4 = await rateLimit("test", 3, 60);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(r4.ok).toBe(false);
  });

  test("fails open when Redis is null", async () => {
    vi.mocked(getRedis).mockReturnValue(null);
    const r = await rateLimit("anything", 1, 60);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(1);
  });

  test("fails open on Redis error", async () => {
    const fake: FakeClient = {
      defineCommand: vi.fn(function (this: FakeClient, name: string) {
        this[name as "scooteringSlidingRateLimit"] = vi.fn(async () => {
          throw new Error("boom");
        });
      }),
    };
    vi.mocked(getRedis).mockReturnValue(fake as never);
    const r = await rateLimit("err", 1, 60);
    expect(r.ok).toBe(true);
  });

  test("invokes the defined command with the client as `this`", async () => {
    // ioredis's generated scripting function reads `this.options` at runtime.
    // A standalone function reference would crash with
    // `Cannot read properties of undefined (reading 'options')` — make sure
    // the wrapper preserves the receiver.
    const received: unknown[] = [];
    const fake: FakeClient = {
      defineCommand: vi.fn(function (this: FakeClient, name: string) {
        this[name as "scooteringSlidingRateLimit"] = vi.fn(async function (
          this: unknown,
        ) {
          received.push(this);
          // Touching `this.options` is what the real ioredis does — if `this`
          // were undefined this would throw.
          void (this as { options?: unknown }).options;
          return [1, 0, Date.now() + 60_000] as [number, number, number];
        });
      }),
    };
    vi.mocked(getRedis).mockReturnValue(fake as never);
    const r = await rateLimit("bound", 1, 60);
    expect(r.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(fake);
  });

  test("registers the Lua script only once per client", async () => {
    const fake = makeFake(() => [1, 0, Date.now() + 60_000]);
    vi.mocked(getRedis).mockReturnValue(fake as never);
    await rateLimit("a", 1, 60);
    await rateLimit("b", 1, 60);
    expect(fake.defineCommand).toHaveBeenCalledTimes(1);
  });
});
