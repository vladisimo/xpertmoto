/**
 * Booking-confirmation notification queue.
 *
 * `confirmBookingPayment` enqueues here after the booking flips to
 * CONFIRMED so the email render + Resend/Twilio round trips don't sit
 * inside the checkout response. The processor is the extracted
 * `sendBookingConfirmationNotification` — the same code the service used
 * to run inline, so behaviour is identical, just off the request path.
 *
 * Fallback: without Redis (local dev, tests) the enqueue helper runs the
 * send inline, mirroring the support-notify pattern. Inline failures are
 * swallowed (logged) — the booking is already CONFIRMED and the customer
 * still sees the confirmation page; a lost email must never fail checkout.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendBookingConfirmationNotification } from "@/server/services/booking-confirmation";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "booking-confirmation-notify" as const;

export type BookingConfirmationNotifyJob = { bookingId: string };

/**
 * Enqueue the confirmation send for a just-confirmed booking. The confirm
 * paths are consumed-once gated (CAS on PENDING_PAYMENT), so exactly one
 * caller per booking ever reaches this.
 */
export async function enqueueBookingConfirmationNotify(
  bookingId: string,
): Promise<"queued" | "synced" | "skipped"> {
  const q = getQueue(QUEUE);
  if (q) {
    await q.add("notify", { bookingId } satisfies BookingConfirmationNotifyJob);
    return "queued";
  }
  try {
    await sendBookingConfirmationNotification(prisma, bookingId);
    return "synced";
  } catch (err) {
    logger.error(
      { err, bookingId },
      "inline booking-confirmation notify failed; booking remains CONFIRMED",
    );
    return "skipped";
  }
}

export function startBookingConfirmationNotifyWorker(): void {
  registerWorker<BookingConfirmationNotifyJob>(QUEUE, async (job) => {
    await sendBookingConfirmationNotification(prisma, job.data.bookingId);
  });
}
