import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isGps51Configured, runGps51Sync } from "@/server/services/gps51";
import { getQueue, monitorCron, registerWorker } from "./queue";

/**
 * GPS51 live-position poller. One batched `lastposition` call per minute covers
 * the whole fleet (deviceids omitted ⇒ all devices) — O(1) in fleet size and
 * within the 1440/day base quota. Concurrency 1: the sync advances a single
 * server-side cursor, so runs must be serial. Compression/retention of the
 * VehicleTelemetry hypertable is handled by TimescaleDB, not here.
 *
 * NOTE: this job never calls querytracks — the GPS51 wiki forbids automatic
 * track sync. History accrues purely from these lastposition snapshots.
 */
const QUEUE = "gps51-sync" as const;

export async function runGps51SyncTick() {
  if (!(await isGps51Configured())) {
    logger.debug("gps51-sync: skipped — GPS51 not configured");
    return { skipped: true as const };
  }
  return runGps51Sync(prisma);
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
