import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "stuck-webhook-recovery" as const;
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS_BEFORE_ALERT = 5;

/**
 * Runs every 5 minutes. Finds `StripeWebhookEvent` rows in `PROCESSING`
 * status for longer than 10 minutes — almost always a crashed handler
 * that never got to write PROCESSED or FAILED. Recovery strategy:
 *   - < 5 attempts: flip back to RECEIVED so the next Stripe retry can
 *     re-enter the handler (Stripe's retry schedule will re-deliver).
 *     We also queue a synthetic retry by re-posting the payload to our
 *     own webhook route — but keeping that off the cron is safer:
 *     Stripe's retries are authoritative.
 *   - >= 5 attempts: flip to FAILED and alert managers. The event will
 *     need manual replay from the Stripe dashboard.
 */
export async function runStuckWebhookRecovery(): Promise<{
  reopened: number;
  failed: number;
}> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuck = await prisma.stripeWebhookEvent.findMany({
    where: {
      status: "PROCESSING",
      receivedAt: { lt: cutoff },
    },
    select: { id: true, type: true, attempts: true },
  });
  if (stuck.length === 0) return { reopened: 0, failed: 0 };

  let reopened = 0;
  let failed = 0;
  for (const evt of stuck) {
    if ((evt.attempts ?? 0) >= MAX_ATTEMPTS_BEFORE_ALERT) {
      await prisma.stripeWebhookEvent.update({
        where: { id: evt.id },
        data: {
          status: "FAILED",
          errorReason: `Stuck in PROCESSING for > ${STUCK_THRESHOLD_MS / 60_000}m across ${evt.attempts} attempts`,
        },
      });
      failed += 1;
      const managers = await prisma.user.findMany({
        where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
        select: { id: true },
      });
      for (const m of managers) {
        await sendNotification({
          userId: m.id,
          type: "INCIDENT_REPORTED",
          channels: ["EMAIL", "IN_APP"],
          subject: `Stripe webhook event stuck — ${evt.type}`,
          title: "Stripe webhook handler failed repeatedly",
          body: `Event ${evt.id} (${evt.type}) has been stuck in PROCESSING across ${evt.attempts} attempts. Replay from the Stripe dashboard once the root cause is resolved: Dashboard → Developers → Webhooks → your endpoint → Events → ${evt.id} → Resend.`,
          data: { eventId: evt.id, type: evt.type, attempts: evt.attempts },
        });
      }
      continue;
    }
    // Reset to RECEIVED so Stripe's own retry (which will arrive with the
    // same event id) re-enters our handler: the webhook route's status-aware
    // claim reprocesses RECEIVED/FAILED rows and only acks
    // PROCESSED/PROCESSING ones as duplicates.
    await prisma.stripeWebhookEvent.update({
      where: { id: evt.id },
      data: { status: "RECEIVED" },
    });
    reopened += 1;
    logger.warn(
      { eventId: evt.id, type: evt.type, attempts: evt.attempts },
      "stripe webhook stuck in PROCESSING — reset to RECEIVED",
    );
  }
  return { reopened, failed };
}

export function startStuckWebhookRecoveryScheduler() {
  registerWorker(QUEUE, async () => runStuckWebhookRecovery());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "every-5m",
    {},
    { repeat: { pattern: "*/5 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-every-5m" },
  );
}
