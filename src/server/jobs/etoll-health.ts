import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

/**
 * G21 — E-Toll scraper health monitor.
 *
 * NSW E-Toll syncing relies on a Playwright scraper against the
 * consumer portal. The portal DOM can change without notice; a silent
 * break means we stop ingesting tolls and, without this monitor, the
 * first sign would be an irritated customer weeks later.
 *
 * This job runs every 2 hours and checks whether the `etoll-sync`
 * queue has produced any `etoll-sync.complete` audit entries in the
 * last ETOLL_HEALTH_WINDOW_HOURS. If not, it pages the manager group.
 *
 * Idempotency: alerts are throttled via a SystemSetting cooldown so we
 * don't spam managers every tick — one alert per 12-hour window.
 */

const QUEUE = "etoll-health" as const;
const ETOLL_HEALTH_WINDOW_HOURS = 48; // E-Toll sync is scheduled every 6h; 48h gives plenty of room
const ALERT_COOLDOWN_HOURS = 12;

export async function runEtollHealth(): Promise<{ ok: boolean; lastSyncAt: Date | null }> {
  const windowStart = new Date(Date.now() - ETOLL_HEALTH_WINDOW_HOURS * 3600 * 1000);

  // Look at AuditLog for a recent etoll-sync.complete entry. Falls back to
  // etoll-sync.start if complete is missing, to avoid false positives during
  // long-running initial syncs.
  const lastSuccess = await prisma.auditLog.findFirst({
    where: {
      action: { in: ["etoll-sync.complete", "etoll-sync.start"] },
      status: "SUCCESS",
      timestamp: { gte: windowStart },
    },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true, action: true },
  });

  if (lastSuccess) {
    logger.debug({ lastSuccess }, "etoll-health: recent sync found, healthy");
    return { ok: true, lastSyncAt: lastSuccess.timestamp };
  }

  // Cooldown check
  const cooldownStart = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 3600 * 1000);
  const recentAlert = await prisma.auditLog.findFirst({
    where: { action: "etoll-health.alert_sent", timestamp: { gte: cooldownStart } },
    select: { id: true },
  });
  if (recentAlert) {
    logger.info("etoll-health: within cooldown, skipping alert");
    return { ok: false, lastSyncAt: null };
  }

  const managers = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
    take: 5,
  });
  for (const m of managers) {
    await sendNotification({
      userId: m.id,
      type: "INCIDENT_REPORTED",
      channels: ["EMAIL", "IN_APP"],
      subject: "E-Toll sync has not run successfully in 48 hours",
      title: "E-Toll sync stalled",
      body: `No successful etoll-sync completion in the last ${ETOLL_HEALTH_WINDOW_HOURS} hours. Likely causes: portal DOM change, credential rotation, rate limiting. Check logs in Sentry and docs/payments/runbook-webhook-replay.md for the E-Toll section.`,
      data: { windowHours: ETOLL_HEALTH_WINDOW_HOURS },
    });
  }

  // Record the alert so the cooldown works.
  await prisma.auditLog.create({
    data: {
      category: "JOB",
      action: "etoll-health.alert_sent",
      entity: "Integration",
      method: "JOB",
      path: QUEUE,
      status: "SUCCESS",
      newData: { windowHours: ETOLL_HEALTH_WINDOW_HOURS, managersNotified: managers.length },
    },
  });

  logger.warn({ managersNotified: managers.length }, "etoll-health: alerted — no sync success in window");
  return { ok: false, lastSyncAt: null };
}

export function startEtollHealthScheduler() {
  registerWorker(QUEUE, async () => runEtollHealth());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Every 2 hours.
  q.add(
    "every-2h",
    {},
    { repeat: { pattern: "0 */2 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-every-2h" },
  );
}
