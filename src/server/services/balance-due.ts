import type { Prisma, PaymentType, PaymentStatus } from "@prisma/client";

/**
 * Booking.balanceDue is a stored running counter, not a value derived from
 * the payment ledger. Ancillary charges are *added* to it when raised (as a
 * PENDING Payment) and so must be *removed* from it when the charge is
 * actually collected. This module is the single source of truth for both
 * halves of that contract.
 *
 * The initial deposit (BOOKING_PAYMENT) is deliberately NOT in this set:
 * the deposit never enters balanceDue — at confirmation the balance is set
 * to `totalAmount - payOnline`, so the captured deposit is excluded by
 * construction (see booking.ts). Bond / gift-card / refund / payout types
 * are likewise not customer-owed ancillary charges and must never be
 * decremented from balanceDue on capture.
 */
export const BALANCE_AFFECTING_CHARGE_TYPES: readonly PaymentType[] = [
  "EXTENSION",
  "MANUAL_CHARGE",
  "LATE_FEE",
  "FUEL_CHARGE",
  "DAMAGE_CHARGE",
  "INFRINGEMENT_RECOVERY",
  "SWAP_ADJUSTMENT",
  "SUBSCRIPTION_CHARGE",
  "CLEANING_FEE",
  "ADDON_CHARGE",
  "ZONE_SURCHARGE",
  "FUEL_DELIVERY_FEE",
] as const;

export function isBalanceAffectingCharge(type: PaymentType): boolean {
  return BALANCE_AFFECTING_CHARGE_TYPES.includes(type);
}

/** Minimal client surface — satisfied by both the top-level PrismaClient and
 *  a `$transaction` tx, so callers can pass whichever they hold. */
type BalanceDuePrismaLike = {
  booking: {
    findUnique: (args: {
      where: { id: string };
      select: { balanceDue: true };
    }) => Promise<{ balanceDue: Prisma.Decimal | number } | null>;
    update: (args: {
      where: { id: string };
      data: { balanceDue: number };
    }) => Promise<unknown>;
  };
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Apply a charge capture to `Booking.balanceDue`, removing the increment
 * that was added when the charge was raised. Centralises the decrement so
 * the three capture paths (capture-pending job, bookingSettlement.captureNow,
 * the Stripe payment_intent.succeeded webhook) cannot drift.
 *
 * Idempotent and safe to over-call:
 *   - skips non-balance-affecting types (deposit / bond / refund / …),
 *   - skips when there is no booking,
 *   - skips when the charge was *already* SUCCEEDED — guards webhook
 *     redelivery and the deposit's own payment_intent.succeeded event from
 *     double-decrementing,
 *   - clamps at zero so a balance can never go negative.
 *
 * Pass the same `db`/`tx` the status flip ran on so the two writes share a
 * transaction when the caller has one.
 */
export async function applyCaptureToBalanceDue(
  db: BalanceDuePrismaLike,
  charge: {
    bookingId: string | null;
    type: PaymentType;
    amount: Prisma.Decimal | number;
    previousStatus: PaymentStatus | null;
  },
): Promise<{ applied: boolean; newBalanceDue?: number }> {
  if (!charge.bookingId) return { applied: false };
  if (charge.previousStatus === "SUCCEEDED") return { applied: false };
  if (!isBalanceAffectingCharge(charge.type)) return { applied: false };

  const booking = await db.booking.findUnique({
    where: { id: charge.bookingId },
    select: { balanceDue: true },
  });
  if (!booking) return { applied: false };

  const next = Math.max(0, round2(Number(booking.balanceDue) - Number(charge.amount)));
  await db.booking.update({
    where: { id: charge.bookingId },
    data: { balanceDue: next },
  });
  return { applied: true, newBalanceDue: next };
}
