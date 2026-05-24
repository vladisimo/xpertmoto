import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { chargeOffSessionForUser } from "@/server/services/stripe-customer";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { writePaymentEvent } from "@/server/services/payment-events";
import { sendNotification } from "@/server/services/notification-sender";
import { applyCaptureToBalanceDue } from "@/server/services/balance-due";
import { getBranding } from "@/lib/branding";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import { getQueue, registerWorker } from "./queue";

/**
 * G5 — capture-pending-payments
 *
 * Walks `Payment` rows in `PENDING` status that were created for ancillary
 * charges (LATE_FEE / FUEL_CHARGE / DAMAGE_CHARGE / INFRINGEMENT_RECOVERY /
 * MANUAL_CHARGE / EXTENSION / SWAP_ADJUSTMENT), waits a short grace period
 * so the authoring transaction can commit, and attempts an off-session
 * capture against the customer's stored default payment method.
 *
 * Outcomes:
 *   - Stripe succeeded        → Payment → SUCCEEDED, stripeChargeId set
 *   - Stripe requires_action  → Payment remains PENDING, customer emailed
 *                               to complete 3DS (P0 keeps it manual; a P1
 *                               follow-up can automate via SetupIntent
 *                               re-auth flows)
 *   - Stripe failed           → Payment → FAILED, manager notified
 *   - No stored PM            → Payment stays PENDING, customer emailed a
 *                               payment link (link generation is P1; P0
 *                               sends the reminder only)
 *
 * Idempotency: uses `Payment.id` as the Stripe idempotency key; a second
 * run with the same id returns Stripe's cached response. Rows with a
 * populated `stripePaymentIntentId` are skipped — the initial capture was
 * already attempted, and retries are out-of-scope for P0 (G8 covers that).
 */

const QUEUE = "capture-pending-payments" as const;
const DEFAULT_GRACE_SECONDS = 30; // don't pick up rows created within the last 30s
const DEFAULT_BATCH = 100;
const DEFAULT_MAX_ATTEMPTS = 3;

const ELIGIBLE_TYPES: Prisma.PaymentWhereInput["type"] = {
  in: [
    "LATE_FEE",
    "FUEL_CHARGE",
    "DAMAGE_CHARGE",
    "INFRINGEMENT_RECOVERY",
    "MANUAL_CHARGE",
    "EXTENSION",
    // Phase A2 — recurring charges on long-term hires.
    "SUBSCRIPTION_CHARGE",
    // Mid-rental vehicle-swap delta (upgrade upcharge). Fault/operational
    // swaps never create a Payment row; only spec-change upgrades do.
    "SWAP_ADJUSTMENT",
  ],
};

export type CapturePendingResult = {
  scanned: number;
  succeeded: number;
  requiresAction: number;
  failed: number;
  skippedNoPm: number;
};

export async function runCapturePendingPayments(
  opts: { graceSeconds?: number; batch?: number; maxAttempts?: number } = {},
): Promise<CapturePendingResult> {
  const graceSeconds = opts.graceSeconds ?? DEFAULT_GRACE_SECONDS;
  const batch = opts.batch ?? DEFAULT_BATCH;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const cutoff = new Date(Date.now() - graceSeconds * 1000);

  const rows = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      type: ELIGIBLE_TYPES,
      createdAt: { lte: cutoff },
      stripePaymentIntentId: null,
      customerId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: batch,
    select: {
      id: true,
      reference: true,
      customerId: true,
      bookingId: true,
      type: true,
      amount: true,
      notes: true,
      booking: {
        select: {
          bookingReference: true,
          pickupDepot: { select: { slug: true } },
        },
      },
    },
  });

  const result: CapturePendingResult = {
    scanned: rows.length,
    succeeded: 0,
    requiresAction: 0,
    failed: 0,
    skippedNoPm: 0,
  };

  for (const row of rows) {
    if (!row.customerId) continue;
    const attemptKey = `payment-capture:${row.id}:${row.reference}`;
    const description = `${row.type} — ${row.booking?.bookingReference ?? row.reference}`;
    const customerId = row.customerId;
    const depotSlug = row.booking?.pickupDepot?.slug;
    // One event per attempt, discriminated by `outcome`, so the PostHog
    // capture-success funnel and failure breakdown both read off a single
    // event. Best-effort — never blocks the capture loop.
    const emitAttempt = (outcome: string, extra?: Record<string, unknown>) =>
      trackServer({
        event: SERVER_EVENTS.paymentCaptureAttempt,
        distinctId: customerId,
        properties: {
          paymentId: row.id,
          bookingId: row.bookingId,
          type: row.type,
          amountAud: Number(row.amount),
          outcome,
          ...extra,
        },
        ...(depotSlug ? { groups: { depot: depotSlug } } : {}),
      });

    const charge = await chargeOffSessionForUser({
      userId: row.customerId,
      amount: Number(row.amount),
      description,
      idempotencyKey: attemptKey,
      metadata: {
        paymentId: row.id,
        paymentReference: row.reference,
        paymentType: row.type,
        bookingId: row.bookingId ?? "",
      },
    });

    if (!charge) {
      // No stored PM — bump the skip counter. The debt-reminder job will
      // nudge the customer to add a payment method via the profile page.
      result.skippedNoPm += 1;
      await prisma.payment.update({
        where: { id: row.id },
        data: {
          notes: refreshSkipNote(row.notes),
        },
      });
      await writePaymentAudit(prisma, {
        action: "payment.capture_skipped_no_pm",
        entity: "Payment",
        entityId: row.id,
        userId: row.customerId,
        status: "SUCCESS",
        newData: { paymentId: row.id, paymentType: row.type },
      });
      await emitAttempt("no_pm");
      continue;
    }

    if (charge.status === "succeeded") {
      await prisma.payment.update({
        where: { id: row.id },
        data: {
          status: "SUCCEEDED",
          stripePaymentIntentId: charge.id,
          stripeChargeId: charge.chargeId ?? null,
          processedAt: new Date(),
          notes: appendNote(row.notes, `capture-pending: captured via off-session`),
        },
      });
      // The charge was raised PENDING with its amount added to
      // Booking.balanceDue; now that it's collected, remove it so the
      // customer isn't shown (and dunned for) money already taken.
      await applyCaptureToBalanceDue(prisma, {
        bookingId: row.bookingId,
        type: row.type,
        amount: row.amount,
        previousStatus: "PENDING",
      });
      // Mirror the capture back onto the source Infringement when this
      // is an INFRINGEMENT_RECOVERY payment so the staff Tolls tab and
      // customer-facing surfaces both flip to "Paid".
      if (row.type === "INFRINGEMENT_RECOVERY") {
        try {
          const { markInfringementPaidOnCapture } = await import(
            "@/server/services/infringement-charge"
          );
          await markInfringementPaidOnCapture(prisma, row.reference);
        } catch (err) {
          logger.warn(
            { err, paymentId: row.id, reference: row.reference },
            "capture-pending: failed to flip Infringement.status to PAID (non-blocking)",
          );
        }
      }
      await writePaymentEvent(prisma, {
        paymentId: row.id,
        eventType: "CAPTURED",
        previousStatus: "PENDING",
        newStatus: "SUCCEEDED",
        amountDelta: Number(row.amount),
        source: "job:capture-pending-payments",
        data: { stripePaymentIntentId: charge.id, stripeChargeId: charge.chargeId },
      }, { swallow: true });
      result.succeeded += 1;
      await writePaymentAudit(prisma, {
        action: "payment.captured_offsession",
        entity: "Payment",
        entityId: row.id,
        userId: row.customerId,
        status: "SUCCESS",
        newData: {
          paymentId: row.id,
          paymentType: row.type,
          stripePaymentIntentId: charge.id,
        },
      });
      await emitAttempt("succeeded");
      continue;
    }

    if (charge.status === "requires_action") {
      // Don't mark FAILED — customer must complete 3DS. Leave PENDING and
      // email them. Email copy intentionally doesn't include the amount in
      // the subject — only the booking reference + a prompt.
      result.requiresAction += 1;
      await prisma.payment.update({
        where: { id: row.id },
        data: {
          stripePaymentIntentId: charge.id,
          notes: appendNote(row.notes, `capture-pending: requires_action — 3DS needed`),
        },
      });
      const { siteName } = await getBranding();
      await sendNotification({
        userId: row.customerId,
        type: "PAYMENT_RECEIVED", // reusing template; P1 adds PAYMENT_ACTION_REQUIRED
        channels: ["EMAIL"],
        subject: `Action required on your booking${row.booking ? ` — ${row.booking.bookingReference}` : ""}`,
        title: "Please complete payment authentication",
        body: `Your card issuer requires an extra verification step to complete a pending charge. Please sign in to your ${siteName} account to finish the payment.\n\nReference: ${row.reference}`,
        bookingId: row.bookingId ?? undefined,
        data: { paymentReference: row.reference },
      });
      await writePaymentAudit(prisma, {
        action: "payment.capture_requires_action",
        entity: "Payment",
        entityId: row.id,
        userId: row.customerId,
        status: "SUCCESS",
        newData: { paymentId: row.id, stripePaymentIntentId: charge.id },
      });
      await emitAttempt("requires_action");
      continue;
    }

    // Failed or requires_payment_method. Hard declines (insufficient
    // funds, card_declined, expired_card) go straight to FAILED; transient
    // errors (processing_error, network issues) hand off to the G8 retry
    // queue with exponential backoff.
    const retryable = isRetryableError(charge.errorCode);
    if (retryable) {
      await prisma.payment.update({
        where: { id: row.id },
        data: {
          stripePaymentIntentId: charge.id,
          notes: appendNote(
            row.notes,
            `capture-pending: ${charge.status} — ${charge.errorCode ?? "stripe_error"} (queued for retry)`,
          ),
        },
      });
      await writePaymentEvent(prisma, {
        paymentId: row.id,
        eventType: "RETRY_ATTEMPTED",
        source: "job:capture-pending-payments",
        data: {
          stripePaymentIntentId: charge.id,
          errorCode: charge.errorCode,
          attemptedStatus: charge.status,
        },
      }, { swallow: true });
      try {
        const { enqueueCaptureRetry } = await import("./capture-retry");
        await enqueueCaptureRetry({ paymentId: row.id, attempt: 1, errorCode: charge.errorCode });
        result.failed += 1;
        await emitAttempt("queued_retry", { errorCode: charge.errorCode ?? null });
        continue;
      } catch (err) {
        logger.warn({ err, paymentId: row.id }, "could not enqueue capture-retry; marking FAILED");
        // fall through to hard-decline handling below
      }
    }

    result.failed += 1;
    await prisma.payment.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        stripePaymentIntentId: charge.id,
        notes: appendNote(
          row.notes,
          `capture-pending: ${charge.status} — ${charge.errorCode ?? "stripe_error"}`,
        ),
      },
    });
    await writePaymentEvent(prisma, {
      paymentId: row.id,
      eventType: "STATUS_CHANGED",
      previousStatus: "PENDING",
      newStatus: "FAILED",
      source: "job:capture-pending-payments",
      data: { stripePaymentIntentId: charge.id, errorCode: charge.errorCode },
    }, { swallow: true });
    logger.warn(
      {
        paymentId: row.id,
        paymentType: row.type,
        stripeStatus: charge.status,
        errorCode: charge.errorCode,
      },
      "capture-pending: off-session charge failed",
    );
    await writePaymentAudit(prisma, {
      action: "payment.capture_failed",
      entity: "Payment",
      entityId: row.id,
      userId: row.customerId,
      status: "FAILURE",
      errorCode: charge.errorCode ?? "STRIPE_FAILED",
      newData: {
        paymentId: row.id,
        stripePaymentIntentId: charge.id,
        errorCode: charge.errorCode,
      },
    });
    // Notify managers so someone can reach out — chargebacks and
    // hard-declines are the common "must-investigate" failure modes.
    const managers = await prisma.user.findMany({
      where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
      take: 5, // rate-limit the fan-out per payment
    });
    for (const m of managers) {
      await sendNotification({
        userId: m.id,
        type: "INCIDENT_REPORTED",
        channels: ["IN_APP"],
        subject: `Payment capture failed — ${row.reference}`,
        title: "Payment capture failed",
        body: `Off-session capture on payment ${row.reference} failed (${charge.errorCode ?? charge.status}). Investigate and follow up with the customer.`,
        bookingId: row.bookingId ?? undefined,
        data: { paymentId: row.id, paymentType: row.type },
      });
    }
    await emitAttempt("failed", { errorCode: charge.errorCode ?? null });
  }

  // Reference to maxAttempts kept for future retry logic (G8). Silence the
  // unused warning without masking the plumbing.
  void maxAttempts;

  return result;
}

/**
 * Stripe error codes grouped. Hard declines go to FAILED immediately;
 * transient / processing / network errors go to the G8 retry queue;
 * Radar fraud blocks are a third class — they're not retryable (the card
 * will keep being blocked) but they need a different customer message
 * ("blocked by risk rules") and manager escalation rather than a polite
 * "try another card".
 */
export function classifyStripeDecline(code?: string): "retryable" | "hard_decline" | "fraud_block" {
  if (!code) return "retryable"; // no code = unknown origin, give it a retry
  const fraudBlocks = new Set([
    // Radar-specific rejections
    "fraudulent",
    "lost_card",
    "stolen_card",
    "pickup_card",
    // Rule-based Radar blocks surface as generic declined but with
    // decline_code "fraudulent" on the charge — capture-pending-payments
    // should already pass the decline_code when available.
    "blocked_by_risk_rules",
  ]);
  if (fraudBlocks.has(code)) return "fraud_block";
  const hardDeclines = new Set([
    "card_declined",
    "insufficient_funds",
    "expired_card",
    "incorrect_cvc",
    "authentication_required",
    "do_not_honor",
  ]);
  return hardDeclines.has(code) ? "hard_decline" : "retryable";
}

function isRetryableError(code?: string): boolean {
  return classifyStripeDecline(code) === "retryable";
}

/**
 * Customer-facing copy for a decline. Differentiates "try another card"
 * from "contact us" when the transaction was blocked by risk rules —
 * telling a fraud-flagged customer to retry is a worse experience AND
 * increases Stripe's block count.
 */
export function customerDeclineCopy(code?: string): string {
  const kind = classifyStripeDecline(code);
  if (kind === "fraud_block") {
    return "This payment was blocked by our risk checks. Please contact our support team to complete your booking.";
  }
  if (kind === "hard_decline") {
    return "Your card was declined. Please try a different card or contact your bank.";
  }
  return "Payment couldn't be completed. Please try again or try a different card.";
}

function appendNote(existing: string | null, add: string): string {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${add}`;
  return existing ? `${existing}\n${line}` : line;
}

/** Marker text for the no-stored-PM skip line. Constant so we can find and
 *  collapse prior occurrences rather than stacking a new one each tick. */
export const NO_PM_SKIP_MARKER = "capture-pending: skipped — no stored PM";

/**
 * Like {@link appendNote}, but for the no-stored-PM skip line specifically.
 * A PENDING charge with no usable PM keeps matching the scan query every
 * tick, so a plain append would grow `notes` by one line every 5 minutes
 * forever (the bug behind the runaway Charges blob). Instead we keep a
 * single skip line and refresh its timestamp, leaving any non-skip lines
 * (captured / requires_action / failed) untouched. Idempotent across runs.
 */
export function refreshSkipNote(existing: string | null): string {
  const line = `[${new Date().toISOString()}] ${NO_PM_SKIP_MARKER}`;
  if (!existing) return line;
  const kept = existing.split("\n").filter((l) => !l.includes(NO_PM_SKIP_MARKER));
  return kept.length ? `${kept.join("\n")}\n${line}` : line;
}

export function startCapturePendingPaymentsScheduler() {
  registerWorker(QUEUE, async () => runCapturePendingPayments());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Every 5 minutes during business hours is the plan's cadence. Cron
  // pattern covers all days to avoid a weekend backlog.
  q.add(
    "tick",
    {},
    { repeat: { pattern: "*/5 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-tick" },
  );
}
