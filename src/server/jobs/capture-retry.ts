import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { chargeOffSessionForUser } from "@/server/services/stripe-customer";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { writePaymentEvent } from "@/server/services/payment-events";
import { applyCaptureToBalanceDue } from "@/server/services/balance-due";
import { sendNotification } from "@/server/services/notification-sender";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import { getQueue, registerWorker } from "./queue";

/**
 * G8 — capture-retry with exponential backoff.
 *
 * Handles transient failures from capture-pending-payments: processing
 * errors, gateway 5xx, network issues. Schedule per-attempt:
 *   attempt 1 → +5 min (scheduled by the caller at initial failure)
 *   attempt 2 → +30 min
 *   attempt 3 → +2 h
 *   attempt 4 → +12 h
 *   attempt 5 → +24 h
 *   exhausted → mark Payment FAILED, alert manager
 *
 * Idempotent on `(paymentId, attempt)` — a second enqueue with the same
 * tuple is a no-op via BullMQ's `jobId`.
 */

const QUEUE = "capture-retry" as const;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];

export type CaptureRetryJobData = {
  paymentId: string;
  attempt: number;
  errorCode?: string;
};

export async function enqueueCaptureRetry(data: CaptureRetryJobData): Promise<void> {
  const q = getQueue(QUEUE);
  if (!q) {
    logger.warn({ paymentId: data.paymentId }, "capture-retry queue not available (no Redis); skipping");
    return;
  }
  const delay = BACKOFF_MS[Math.min(data.attempt - 1, BACKOFF_MS.length - 1)] ?? 60_000;
  await q.add(`retry-${data.paymentId}-${data.attempt}`, data, {
    delay,
    jobId: `${data.paymentId}:${data.attempt}`,
    attempts: 1,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  });
}

export async function runCaptureRetry(data: CaptureRetryJobData): Promise<"succeeded" | "requeued" | "exhausted" | "missing"> {
  const row = await prisma.payment.findUnique({
    where: { id: data.paymentId },
    select: {
      id: true,
      reference: true,
      customerId: true,
      bookingId: true,
      type: true,
      amount: true,
      status: true,
      booking: {
        select: {
          bookingReference: true,
          pickupDepot: { select: { slug: true } },
        },
      },
    },
  });
  if (!row || !row.customerId || row.status !== "PENDING") {
    logger.info({ paymentId: data.paymentId, status: row?.status }, "capture-retry: row gone or already resolved");
    return "missing";
  }
  const depotSlug = row.booking?.pickupDepot?.slug;
  const emitAttempt = (outcome: string, extra?: Record<string, unknown>) =>
    trackServer({
      event: SERVER_EVENTS.paymentCaptureAttempt,
      distinctId: row.customerId!,
      properties: {
        paymentId: row.id,
        bookingId: row.bookingId,
        type: row.type,
        amountAud: Number(row.amount),
        attempt: data.attempt,
        retry: true,
        outcome,
        ...extra,
      },
      ...(depotSlug ? { groups: { depot: depotSlug } } : {}),
    });

  const attemptKey = `payment-capture-retry:${row.id}:${data.attempt}:${row.reference}`;
  const charge = await chargeOffSessionForUser({
    userId: row.customerId,
    amount: Number(row.amount),
    description: `retry attempt ${data.attempt} — ${row.type}`,
    idempotencyKey: attemptKey,
    metadata: {
      paymentId: row.id,
      paymentReference: row.reference,
      paymentType: row.type,
      bookingId: row.bookingId ?? "",
      retryAttempt: String(data.attempt),
    },
  });

  if (charge?.status === "succeeded") {
    // CAS + balanceDue decrement in one transaction — the same contract as
    // the other capture paths (capture-pending job / captureNow / webhook).
    // A plain update here used to flip the row to SUCCEEDED without the
    // decrement, and the webhook's own CAS then found the row already
    // SUCCEEDED and skipped it too — so every retry-collected charge left
    // its amount stuck on Booking.balanceDue (dunned forever).
    await prisma.$transaction(async (tx) => {
      const flipped = await tx.payment.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: {
          status: "SUCCEEDED",
          stripePaymentIntentId: charge.id,
          stripeChargeId: charge.chargeId ?? null,
          processedAt: new Date(),
        },
      });
      if (flipped.count > 0) {
        await applyCaptureToBalanceDue(tx, {
          bookingId: row.bookingId,
          type: row.type,
          amount: row.amount,
          previousStatus: "PENDING",
        });
      }
    });
    await writePaymentEvent(prisma, {
      paymentId: row.id,
      eventType: "CAPTURED",
      previousStatus: "PENDING",
      newStatus: "SUCCEEDED",
      amountDelta: Number(row.amount),
      source: `job:capture-retry:${data.attempt}`,
      data: { stripePaymentIntentId: charge.id, attempt: data.attempt },
    }, { swallow: true });
    await emitAttempt("succeeded");
    return "succeeded";
  }

  if (data.attempt >= MAX_ATTEMPTS) {
    await prisma.payment.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        stripePaymentIntentId: charge?.id ?? null,
      },
    });
    await writePaymentEvent(prisma, {
      paymentId: row.id,
      eventType: "RETRY_EXHAUSTED",
      previousStatus: "PENDING",
      newStatus: "FAILED",
      source: `job:capture-retry:${data.attempt}`,
      data: { errorCode: charge?.errorCode, attempts: data.attempt },
    }, { swallow: true });
    await writePaymentAudit(prisma, {
      action: "payment.capture_retry_exhausted",
      entity: "Payment",
      entityId: row.id,
      userId: row.customerId,
      status: "FAILURE",
      errorCode: charge?.errorCode ?? "RETRY_EXHAUSTED",
      newData: { attempts: data.attempt, finalStatus: charge?.status },
    });
    const managers = await prisma.user.findMany({
      where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
      take: 3,
    });
    for (const m of managers) {
      await sendNotification({
        userId: m.id,
        type: "INCIDENT_REPORTED",
        channels: ["IN_APP", "EMAIL"],
        subject: `Payment retry exhausted — ${row.reference}`,
        title: "Payment retry exhausted",
        body: `${MAX_ATTEMPTS} off-session capture attempts on payment ${row.reference} all failed. Manual follow-up required.`,
        bookingId: row.bookingId ?? undefined,
        data: { paymentId: row.id, paymentReference: row.reference, attempts: data.attempt },
      });
    }
    await emitAttempt("exhausted", { errorCode: charge?.errorCode ?? null });
    return "exhausted";
  }

  // Still retryable — requeue with the next backoff step.
  const nextAttempt = data.attempt + 1;
  await writePaymentEvent(prisma, {
    paymentId: row.id,
    eventType: "RETRY_ATTEMPTED",
    source: `job:capture-retry:${data.attempt}`,
    data: { nextAttempt, errorCode: charge?.errorCode, charge_status: charge?.status },
  }, { swallow: true });
  await enqueueCaptureRetry({ paymentId: row.id, attempt: nextAttempt, errorCode: charge?.errorCode });
  await emitAttempt("requeued", { errorCode: charge?.errorCode ?? null, nextAttempt });
  return "requeued";
}

export function startCaptureRetryWorker() {
  registerWorker<CaptureRetryJobData>(QUEUE, async (job) => {
    await runCaptureRetry(job.data);
  });
}
