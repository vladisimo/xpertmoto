import { describe, it, expect, vi, beforeEach } from "vitest";

const redisSet = vi.fn();
const redisEval = vi.fn();
let redisAvailable = true;
vi.mock("@/lib/redis", () => ({
  getRedis: () => (redisAvailable ? { set: redisSet, eval: redisEval } : null),
}));
vi.mock("@/lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { withJobLock } from "@/server/jobs/run-lock";

beforeEach(() => {
  vi.clearAllMocks();
  redisAvailable = true;
  redisSet.mockResolvedValue("OK");
  redisEval.mockResolvedValue(1);
});

describe("withJobLock", () => {
  it("acquires with NX+EX, runs fn, then compare-and-deletes", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const res = await withJobLock("rewards-recompute", 1800, fn);
    expect(res).toBe(42);
    expect(redisSet).toHaveBeenCalledWith(
      "job-lock:rewards-recompute",
      expect.any(String),
      "EX",
      1800,
      "NX",
    );
    const token = redisSet.mock.calls[0]![1];
    expect(redisEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call"),
      1,
      "job-lock:rewards-recompute",
      token,
    );
  });

  it("skips the run (returns null) when the lock is held", async () => {
    redisSet.mockResolvedValue(null);
    const fn = vi.fn();
    const res = await withJobLock("rewards-recompute", 1800, fn);
    expect(res).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(redisEval).not.toHaveBeenCalled();
  });

  it("releases the lock even when fn throws", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("scan died"));
    await expect(withJobLock("rewards-recompute", 1800, fn)).rejects.toThrow("scan died");
    expect(redisEval).toHaveBeenCalledTimes(1);
  });

  it("runs fn directly without Redis (single-process dev)", async () => {
    redisAvailable = false;
    const fn = vi.fn().mockResolvedValue("done");
    expect(await withJobLock("rewards-recompute", 1800, fn)).toBe("done");
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("tolerates a failed release — TTL is the backstop", async () => {
    redisEval.mockRejectedValue(new Error("conn reset"));
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withJobLock("rewards-recompute", 1800, fn)).toBe("ok");
  });
});
