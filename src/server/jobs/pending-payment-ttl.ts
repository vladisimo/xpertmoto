import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "pending-payment-ttl" as const;

export type PendingPaymentTtlResult = {
  scanned: number;
  cancelled: number;
};

/**
 * C3: nightly scan for abandoned bookings. Walks PENDING_PAYMENT and
 * QUOTE bookings older than TTL_HOURS and cancels them with a clear
 * reason. Webhook path handles the real-time case; this catches stuck
 * rows that didn't get a payment_failed signal.
 *
 * Idempotent — only touches rows still in the target statuses.
 */
export async function runPendingPaymentTtl(): Promise<PendingPaymentTtlResult> {
  const ttlHours = await getSetting(
    "booking.pendingPaymentTimeoutHours",
    SETTING_DEFAULTS["booking.pendingPaymentTimeoutHours"],
  );
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

  const candidates = await prisma.booking.findMany({
    where: {
      status: { in: ["PENDING_PAYMENT", "QUOTE"] },
      createdAt: { lt: cutoff },
    },
    select: { id: true, status: true, bookingReference: true, vehicleId: true },
  });

  let cancelled = 0;
  for (const b of candidates) {
    try {
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          status: "CANCELLED",
          cancellationReason: `Auto-cancelled: no payment within ${ttlHours}h`,
          statusLog: {
            create: {
              previousStatus: b.status,
              newStatus: "CANCELLED",
              reason: "Pending-payment TTL exceeded",
            },
          },
        },
      });
      cancelled += 1;
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          bookingId: b.id,
          reference: b.bookingReference,
        },
        "pending-payment-ttl: failed to cancel booking",
      );
    }
  }

  logger.info({ scanned: candidates.length, cancelled }, "pending-payment-ttl finished");
  return { scanned: candidates.length, cancelled };
}

export function startPendingPaymentTtlScheduler() {
  registerWorker(QUEUE, async () => runPendingPaymentTtl());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Nightly at 03:00 Brisbane time — far enough from bond-auto-release
  // (02:00) that the two don't contend.
  q.add(
    "nightly",
    {},
    { repeat: { pattern: "0 3 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
  );
}
