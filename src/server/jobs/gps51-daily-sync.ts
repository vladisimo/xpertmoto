import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isGps51Configured, runGps51DailyTrackSync } from "@/server/services/gps51";
import { getQueue, monitorCron, registerWorker } from "./queue";
import { withJobLock } from "./run-lock";

/**
 * Once-a-day GPS51 full-track sync. For every tracked vehicle it pulls the last
 * 24h via `querytracks` and appends every fix to the VehicleTelemetry hypertable
 * — the authoritative history now that the 1-min poll only updates the live-map
 * position. Dedup is the (deviceId, timestamp) PK.
 *
 * Long full-fleet scan, so it runs under a job lock: a hung/slow run (the pulls
 * are paced under the provider's 10-req/min IP cap, so a large fleet takes
 * ~minutes) can never overlap the next nightly tick. 2h TTL covers a big fleet.
 */
const QUEUE = "gps51-daily-sync" as const;

export async function runGps51DailySyncTick(data?: { hoursBack?: number }) {
  if (!(await isGps51Configured())) {
    logger.debug("gps51-daily-sync: skipped — GPS51 not configured");
    return { skipped: true as const };
  }
  return withJobLock(QUEUE, 2 * 60 * 60, () =>
    runGps51DailyTrackSync(prisma, { hoursBack: data?.hoursBack }),
  );
}

export async function startGps51DailySyncScheduler() {
  registerWorker<{ hoursBack?: number }>(QUEUE, async (job) => runGps51DailySyncTick(job.data), {
    concurrency: 1,
  });
  // 03:20 Brisbane — off-peak, after the 03:00 jobs; only the 1-min poll shares
  // the GPS51 IP at that hour.
  monitorCron(QUEUE, "20 3 * * *", "Australia/Brisbane");
  const q = getQueue(QUEUE);
  if (!q) return;
  await q.add(
    "daily",
    {},
    { repeat: { pattern: "20 3 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
