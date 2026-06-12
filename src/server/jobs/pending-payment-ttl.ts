import * as Sentry from "@sentry/nextjs";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { confirmBookingPayment } from "@/server/services/booking-confirmation";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "pending-payment-ttl" as const;

export type PendingPaymentTtlResult = {
  scanned: number;
  cancelled: number;
  /** Bookings that turned out to be PAID (SUCCEEDED deposit payment) and
   *  were confirmed instead of cancelled. */
  recovered: number;
};

/**
 * C3: nightly scan for abandoned bookings. Walks PENDING_PAYMENT and
 * QUOTE bookings older than TTL_HOURS and cancels them with a clear
 * reason. Webhook path handles the real-time case; this catches stuck
 * rows that didn't get a payment_failed signal.
 *
 * C1 guard: a PENDING_PAYMENT booking with a SUCCEEDED booking payment is
 * NOT abandoned — the customer was charged but the confirm step never ran
 * (browser died and the Stripe webhook rescue also failed). Cancelling it
 * would take the customer's money and kill their booking. Those rows are
 * confirmed via the shared confirmBookingPayment service instead; if the
 * confirm fails (e.g. no vehicle left) the row is left alone and logged
 * loudly for staff follow-up.
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
    select: {
      id: true,
      status: true,
      bookingReference: true,
      vehicleId: true,
      payments: {
        where: { type: "BOOKING_PAYMENT", status: "SUCCEEDED" },
        select: { id: true, stripePaymentIntentId: true },
        take: 1,
      },
    },
  });

  let cancelled = 0;
  let recovered = 0;
  for (const b of candidates) {
    const succeededPayment = b.payments[0];
    if (succeededPayment) {
      try {
        await confirmBookingPayment(prisma, {
          bookingId: b.id,
          paymentIntentId: succeededPayment.stripePaymentIntentId,
          source: "ttl-sweep",
        });
        recovered += 1;
        logger.warn(
          { bookingId: b.id, reference: b.bookingReference },
          "pending-payment-ttl: booking was already paid — confirmed instead of cancelling",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { err: message, bookingId: b.id, reference: b.bookingReference },
          "pending-payment-ttl: paid booking could not be confirmed — needs staff follow-up, NOT cancelling",
        );
        // The customer's money is taken and their booking is invisible —
        // and this branch re-runs every night until someone intervenes.
        // A pino line alone never reaches a human; page the admins.
        Sentry.captureException(err, {
          tags: { job: QUEUE, kind: "paid-booking-rescue-failed" },
          extra: { bookingId: b.id, reference: b.bookingReference },
        });
        try {
          const managers = await prisma.user.findMany({
            where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
            select: { id: true },
          });
          for (const m of managers) {
            await sendNotification({
              userId: m.id,
              type: "INCIDENT_REPORTED",
              channels: ["EMAIL", "IN_APP"],
              subject: `Paid booking stuck unconfirmed — ${b.bookingReference}`,
              title: "Paid booking could not be confirmed",
              body: `Booking ${b.bookingReference} has a successful deposit payment but automatic confirmation keeps failing (latest error: ${message.slice(0, 300)}). The nightly sweep will retry; investigate and confirm or refund manually from the staff console.`,
              bookingId: b.id,
              data: { bookingId: b.id, reference: b.bookingReference },
              // One alert per booking per day even if the job retries.
              dedupKey: `pending-ttl-rescue-failed:${b.id}:${new Date().toISOString().slice(0, 10)}`,
            });
          }
        } catch (notifyErr) {
          logger.warn(
            { err: notifyErr instanceof Error ? notifyErr.message : String(notifyErr), bookingId: b.id },
            "pending-payment-ttl: manager alert failed",
          );
        }
      }
      continue;
    }
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

  logger.info(
    { scanned: candidates.length, cancelled, recovered },
    "pending-payment-ttl finished",
  );
  return { scanned: candidates.length, cancelled, recovered };
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
