import { randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

const log = logger.child({ component: "job-lock" });

/**
 * Best-effort distributed mutex for full-table-scan jobs (rewards
 * recompute, revenue reconcile, insights refresh). Their cron schedules
 * assume the previous run finished — a hung run, a worker restart mid-run,
 * or a second worker instance lets two full scans race the same rows and
 * pile up DB contention. The lock makes the overlap explicit: the loser
 * skips its tick and the next tick picks up normally.
 *
 * `maxRuntimeSec` doubles as the lock TTL so a crashed holder can never
 * wedge the schedule — size it comfortably above the worst observed run.
 * Release is compare-and-delete so a run that outlives its TTL can't free
 * a successor's lock. Without Redis there is exactly one process, so the
 * fence is unnecessary and fn runs directly.
 *
 * Returns null when the lock was held and the run was skipped.
 */
export async function withJobLock<T>(
  name: string,
  maxRuntimeSec: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return fn();

  const key = `job-lock:${name}`;
  const token = randomUUID();
  const acquired = await redis.set(key, token, "EX", maxRuntimeSec, "NX");
  if (acquired !== "OK") {
    log.warn({ job: name }, "previous run still holds the lock — skipping this tick");
    return null;
  }
  try {
    return await fn();
  } finally {
    try {
      await redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        key,
        token,
      );
    } catch (err) {
      log.warn(
        { job: name, err: err instanceof Error ? err.message : String(err) },
        "job lock release failed — lock will expire by TTL",
      );
    }
  }
}
