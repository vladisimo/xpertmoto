import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { refundCharge } from "@/lib/stripe";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

/**
 * Refund retry with exponential backoff — the refund-side mirror of
 * capture-retry. A transient Stripe failure during a cancellation used to
 * leave the customer's money silently stuck: the REFUND Payment row sat
 * FAILED with no retry and no human told (unlike failed CAPTURES, which
 * alert managers). Now the cancel path enqueues here; we re-attempt with the
 * ORIGINAL idempotency key (refund creates are idempotent under it — if the
 * first attempt actually went through, Stripe replays the success) and page
 * the managers when retries exhaust.
 */
const QUEUE = "refund-retry" as const;
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

export type RefundRetryJobData = {
  /** The REFUND Payment row to settle. */
  paymentId: string;
  /** Source charge coordinates for refundCharge. */
  paymentIntentId: string | null;
  chargeId: string | null;
  amountCents: number;
  /** MUST be the original attempt's key so a lost-response first attempt
   *  can't double-refund. */
  idempotencyKey: string;
  attempt: number;
};

export async function enqueueRefundRetry(data: RefundRetryJobData): Promise<void> {
  const q = getQueue(QUEUE);
  if (!q) {
    logger.warn(
      { paymentId: data.paymentId },
      "refund-retry queue not available (no Redis); manual follow-up required",
    );
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

export async function runRefundRetry(
  data: RefundRetryJobData,
): Promise<"succeeded" | "requeued" | "exhausted" | "missing"> {
  const row = await prisma.payment.findUnique({
    where: { id: data.paymentId },
    select: {
      id: true,
      reference: true,
      status: true,
      customerId: true,
      bookingId: true,
      amount: true,
      booking: { select: { bookingReference: true } },
    },
  });
  if (!row || row.status === "SUCCEEDED" || row.status === "REFUNDED") {
    return "missing";
  }

  try {
    const res = await refundCharge({
      paymentIntentId: data.paymentIntentId,
      chargeId: data.chargeId,
      amountCents: data.amountCents,
      reason: "requested_by_customer",
      metadata: { paymentId: row.id, retryAttempt: String(data.attempt) },
      idempotencyKey: data.idempotencyKey,
    });
    if (res.status === "succeeded" || res.status === "pending") {
      await prisma.$transaction(async (tx) => {
        const flipped = await tx.payment.updateMany({
          where: { id: row.id, status: { in: ["FAILED", "PENDING"] } },
          data: {
            status: "SUCCEEDED",
            stripeChargeId: res.id,
            processedAt: new Date(),
            notes: `Refund settled on retry attempt ${data.attempt}`,
          },
        });
        // Same amountPaid mirror the immediate-refund path applies: refunded
        // money is no longer collected money. CAS-guarded so a concurrent
        // settle can't double-decrement.
        if (flipped.count > 0 && row.bookingId) {
          const fresh = await tx.booking.findUniqueOrThrow({
            where: { id: row.bookingId },
            select: { amountPaid: true },
          });
          await tx.booking.update({
            where: { id: row.bookingId },
            data: {
              amountPaid: Math.max(
                0,
                Math.round((Number(fresh.amountPaid) - Number(row.amount)) * 100) / 100,
              ),
            },
          });
        }
      });
      await writePaymentAudit(prisma, {
        action: "refund.retry_succeeded",
        entity: "Payment",
        entityId: row.id,
        userId: row.customerId ?? undefined,
        status: "SUCCESS",
        newData: { attempt: data.attempt, stripeRefundId: res.id },
      });
      return "succeeded";
    }
    throw new Error(`Stripe refund status ${res.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (data.attempt >= MAX_ATTEMPTS) {
      await writePaymentAudit(prisma, {
        action: "refund.retry_exhausted",
        entity: "Payment",
        entityId: row.id,
        userId: row.customerId ?? undefined,
        status: "FAILURE",
        errorCode: "REFUND_RETRY_EXHAUSTED",
        newData: { attempts: data.attempt, lastError: message.slice(0, 200) },
      });
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
          subject: `Customer refund stuck — ${row.booking?.bookingReference ?? row.reference}`,
          title: "Refund could not be processed",
          body:
            `The A$${Number(row.amount).toFixed(2)} refund on ${row.booking?.bookingReference ?? row.reference} ` +
            `failed ${data.attempt} times (last error: ${message.slice(0, 150)}). ` +
            `The customer is owed this money — refund manually from the Stripe dashboard and mark the Payment settled.`,
          bookingId: row.bookingId ?? undefined,
          data: { paymentId: row.id },
        });
      }
      return "exhausted";
    }
    logger.warn(
      { err: message, paymentId: row.id, attempt: data.attempt },
      "refund-retry: attempt failed; requeueing",
    );
    await enqueueRefundRetry({ ...data, attempt: data.attempt + 1 });
    return "requeued";
  }
}

export function startRefundRetryWorker() {
  registerWorker(QUEUE, async (job) => runRefundRetry(job.data as RefundRetryJobData));
}
