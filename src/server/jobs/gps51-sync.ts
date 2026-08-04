import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isGps51Configured, runGps51Sync } from "@/server/services/gps51";
import { getQueue, monitorCron, registerWorker } from "./queue";
import { withJobLock } from "./run-lock";

/**
 * GPS51 live-position poller. One batched `lastposition` call per minute covers
 * the whole fleet (deviceids omitted ⇒ all devices) — O(1) in fleet size and
 * within the 1440/day base quota. The sync advances a single server-side cursor,
 * so runs must be serial: BullMQ `concurrency: 1` serialises within a worker,
 * and a distributed `withJobLock` (55s TTL, just under the 60s cadence) prevents
 * two worker replicas — or a run that overruns a tick — from racing the cursor.
 *
 * History is NOT written here — full-fidelity tracks are owned by the nightly
 * querytracks sync (gps51-daily-sync); this poll only maintains the live-map
 * snapshot. Hypertable compression/retention is handled by TimescaleDB policies.
 */
const QUEUE = "gps51-sync" as const;
const LOCK_TTL_SEC = 55; // just under the 60s cadence; a crashed holder frees by TTL

export async function runGps51SyncTick() {
  if (!(await isGps51Configured())) {
    logger.debug("gps51-sync: skipped — GPS51 not configured");
    return { skipped: true as const };
  }
  return withJobLock(QUEUE, LOCK_TTL_SEC, () => runGps51Sync(prisma));
}

export async function startGps51SyncScheduler() {
  registerWorker(QUEUE, async () => runGps51SyncTick(), { concurrency: 1 });
  monitorCron(QUEUE, "* * * * *", "Australia/Brisbane");
  const q = getQueue(QUEUE);
  if (!q) return;
  await q.add(
    "tick",
    {},
    { repeat: { pattern: "* * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-1min" },
  );
}
