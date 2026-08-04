import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { aud, roundCents, times, divide } from "@/lib/money";
import { chargeOffSessionForUser } from "@/server/services/stripe-customer";
import { classifyStripeDecline } from "@/server/jobs/capture-pending-payments";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { writePaymentEvent } from "@/server/services/payment-events";
import { logger } from "@/lib/logger";

type PrismaLike = PrismaClient | typeof defaultPrisma;

/**
 * Auto-charge the pay-at-pickup remainder at check-out.
 *
 * For PERCENT/FLAT deposit strategies (and ZERO), `balanceDue` after
 * confirmation holds `totalAmount − payOnlineAmount` with NO Payment row
 * behind it — historically collected by staff at the counter. This charges
 * it off-session to the saved card while the customer stands there, so a
 * decline is resolved before keys change hands.
 *
 * The remainder is `balanceDue` MINUS any PENDING balance-affecting rows
 * (those are the capture sweep's to collect — charging them here would
 * double-charge when the sweep also fires).
 *
 * Bookkeeping: type BOOKING_PAYMENT with a bespoke transactional
 * amountPaid/balanceDue recompute (the recordPayment pattern).
 * `applyCaptureToBalanceDue` deliberately excludes BOOKING_PAYMENT, so the
 * Stripe webhook cannot double-decrement this charge.
 *
 * Idempotent via the unique reference `PICKUP-REM-<bookingId>`: a checkOut
 * retry reuses the row, and an already-SUCCEEDED row short-circuits to
 * `not_required`.
 */
export type PickupRemainderOutcome =
  | { outcome: "not_required" }
  | { outcome: "charged"; paymentId: string; amount: number }
  | { outcome: "no_pm"; amount: number }
  | { outcome: "requires_action"; amount: number; stripePaymentIntentId: string }
  | { outcome: "failed"; amount: number; errorCode: string | null; errorMessage: string | null };

export async function chargePickupRemainder(
  prisma: PrismaLike,
  args: { bookingId: string; staffUserId: string },
): Promise<PickupRemainderOutcome> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: args.bookingId },
    select: {
      id: true,
      bookingReference: true,
      customerId: true,
      balanceDue: true,
      amountPaid: true,
      totalAmount: true,
      gstAmount: true,
    },
  });

  const reference = `PICKUP-REM-${booking.id}`;
  const existing = await prisma.payment.findUnique({
    where: { reference },
    select: { id: true, status: true, amount: true },
  });
  if (existing?.status === "SUCCEEDED") return { outcome: "not_required" };

  // PENDING balance-affecting rows are already inside balanceDue AND already
  // owned by the capture sweep — exclude them from the remainder.
  const pendingRaised = await prisma.payment.aggregate({
    where: {
      bookingId: booking.id,
      status: "PENDING",
      // All PENDING rows on a booking are balance-affecting raises except a
      // pre-existing PICKUP-REM retry row, which is the remainder itself.
      reference: { not: reference },
    },
    _sum: { amount: true },
  });
  const remainder = roundCents(
    aud(booking.balanceDue).minus(aud(Number(pendingRaised._sum.amount ?? 0))),
  ).toNumber();
  if (remainder <= 0.009) {
    // A stale PENDING remainder row from a failed earlier attempt must not
    // outlive the balance being settled another way (staff terminal /
    // recordPayment) — it would read as still-owed on pay-now surfaces.
    if (existing?.status === "PENDING") {
      await prisma.payment.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          notes: "Pay-at-pickup remainder superseded — balance settled by another payment",
        },
      });
    }
    return { outcome: "not_required" };
  }

  // GST slice pro-rata of the booking totals (the remainder is a slice of an
  // already-GST-computed total — mirrors confirmBookingPayment's deposit
  // proration; never an inline /11).
  const total = Number(booking.totalAmount);
  const gstSlice =
    total > 0
      ? roundCents(divide(times(aud(booking.gstAmount), remainder), total)).toNumber()
      : 0;

  let payment: { id: string; status: string } | null = existing;
  if (payment && Number(existing!.amount) !== remainder) {
    // Re-priced retry (e.g. a partial terminal payment landed between
    // attempts) — bring the row up to date before charging.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { amount: remainder, gstAmount: gstSlice },
    });
  }
  payment ??= await prisma.payment.create({
    data: {
      reference,
      customerId: booking.customerId,
      bookingId: booking.id,
      type: "BOOKING_PAYMENT",
      method: "STRIPE",
      amount: remainder,
      gstAmount: gstSlice,
      status: "PENDING",
      notes: "Pay-at-pickup remainder — auto-charged at check-out",
    },
    select: { id: true, status: true, amount: true },
  });

  const charge = await chargeOffSessionForUser({
    userId: booking.customerId,
    amount: remainder,
    description: `Balance due at pickup — ${booking.bookingReference}`,
    // Amount in the key: a same-amount retry dedupes at Stripe; a re-priced
    // retry legitimately gets a fresh key instead of a parameter-mismatch.
    idempotencyKey: `pickup-remainder:${payment.id}:${Math.round(remainder * 100)}`,
    metadata: {
      paymentId: payment.id,
      paymentReference: reference,
      paymentType: "BOOKING_PAYMENT",
      bookingId: booking.id,
    },
  });

  if (!charge) {
    return { outcome: "no_pm", amount: remainder };
  }

  if (charge.status === "succeeded") {
    await prisma.$transaction(async (tx) => {
      const flipped = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: {
          status: "SUCCEEDED",
          stripePaymentIntentId: charge.id,
          stripeChargeId: charge.chargeId ?? null,
          processedAt: new Date(),
          processedById: args.staffUserId,
        },
      });
      if (flipped.count > 0) {
        // Bespoke ledger update (BOOKING_PAYMENT is excluded from
        // applyCaptureToBalanceDue by design): the remainder leaves
        // balanceDue and lands in amountPaid, clamped at zero.
        const fresh = await tx.booking.findUniqueOrThrow({
          where: { id: booking.id },
          select: { balanceDue: true, amountPaid: true },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            balanceDue: Math.max(
              0,
              roundCents(aud(fresh.balanceDue).minus(remainder)).toNumber(),
            ),
            amountPaid: roundCents(aud(fresh.amountPaid).plus(remainder)).toNumber(),
          },
        });
      }
    });
    await writePaymentEvent(
      prisma,
      {
        paymentId: payment.id,
        eventType: "CAPTURED",
        previousStatus: "PENDING",
        newStatus: "SUCCEEDED",
        amountDelta: remainder,
        source: "staff:check-out-remainder",
        data: { stripePaymentIntentId: charge.id },
      },
      { swallow: true },
    );
    await writePaymentAudit(prisma, {
      action: "payment.pickup_remainder_charged",
      entity: "Payment",
      entityId: payment.id,
      userId: args.staffUserId,
      status: "SUCCESS",
      newData: { bookingId: booking.id, amountAud: remainder, stripePaymentIntentId: charge.id },
    });
    return { outcome: "charged", paymentId: payment.id, amount: remainder };
  }

  if (charge.status === "requires_action") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        stripePaymentIntentId: charge.id,
        notes: "Pay-at-pickup remainder — requires_action (3DS at counter)",
      },
    });
    return { outcome: "requires_action", amount: remainder, stripePaymentIntentId: charge.id };
  }

  // Hard decline or transient failure: keep the row PENDING (staff can take
  // the terminal payment via recordPayment, which zeroes the remainder for
  // the retry) and surface the reason.
  const kind = classifyStripeDecline(charge.errorCode);
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      stripePaymentIntentId: charge.id,
      notes: `Pay-at-pickup remainder — ${charge.status} (${charge.errorCode ?? "stripe_error"}; ${kind})`,
    },
  });
  logger.warn(
    { bookingId: booking.id, errorCode: charge.errorCode, kind },
    "pickup-remainder: off-session charge failed at check-out",
  );
  return {
    outcome: "failed",
    amount: remainder,
    errorCode: charge.errorCode ?? null,
    errorMessage: charge.errorMessage ?? null,
  };
}
