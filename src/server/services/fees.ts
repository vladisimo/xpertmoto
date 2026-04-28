import {
  BOOKING_RULES,
  CANCELLATION_POLICY,
  EARLY_RETURN_POLICY,
} from "@/lib/constants";
import { aud, times, divide, roundCents, toNumber } from "@/lib/money";

/**
 * Pure fee calculators extracted from the staff-booking router so they can
 * be unit-tested without a database. Both functions encode the business
 * rules from CLAUDE.md §CRITICAL BUSINESS RULES 5 (cancellation) and 6
 * (late returns).
 *
 * All arithmetic routes through `src/lib/money.ts` so intermediate values
 * never leave Decimal precision — avoids the IEEE-754 rounding drift that
 * previous `dailyRate / 8` paths produced on rates like $79.95.
 */

/**
 * Late return fee. Grace period + hourly rate (daily / 8) up to a per-day
 * cap equal to the full daily rate.
 */
export function calcLateFee(args: {
  scheduledReturn: Date;
  actualReturn: Date;
  dailyRate: number;
}): { lateHours: number; fee: number } {
  const gracedHours =
    (args.actualReturn.getTime() - args.scheduledReturn.getTime()) / 3_600_000 -
    BOOKING_RULES.lateReturnGraceHours;
  const lateHours = Math.max(0, gracedHours);
  if (lateHours === 0) return { lateHours: 0, fee: 0 };

  const hourlyRate = divide(args.dailyRate, 8);
  const uncapped = times(hourlyRate, Math.floor(lateHours));
  const dayCap = times(args.dailyRate, Math.ceil(lateHours / 24));
  const fee = roundCents(
    uncapped.lessThan(dayCap) ? uncapped : dayCap,
  );
  return { lateHours, fee: toNumber(fee) };
}

/**
 * Cancellation refund. Applies the sliding-scale from the policy:
 *   - > 72h before pickup  → full refund less admin fee
 *   - 24–72h               → 50% refund less admin fee
 *   - < 24h                → no refund
 * Admin fee is never deducted from a refund that would then go negative.
 */
export function calcCancellationRefund(args: {
  pickupDateTime: Date;
  amountPaid: number;
  now?: Date;
}): { refundPct: number; refund: number; adminFee: number } {
  const now = args.now ?? new Date();
  const hoursUntilPickup =
    (args.pickupDateTime.getTime() - now.getTime()) / 3_600_000;

  let refundPct = 0;
  if (hoursUntilPickup > CANCELLATION_POLICY.fullRefundHours) refundPct = 1;
  else if (hoursUntilPickup > CANCELLATION_POLICY.halfRefundHours) refundPct = 0.5;

  if (refundPct === 0) return { refundPct: 0, refund: 0, adminFee: 0 };

  const gross = times(args.amountPaid, refundPct);
  const adminFeeDec = gross.lessThan(CANCELLATION_POLICY.adminFee)
    ? gross
    : aud(CANCELLATION_POLICY.adminFee);
  return {
    refundPct,
    refund: toNumber(roundCents(gross.minus(adminFeeDec))),
    adminFee: toNumber(adminFeeDec),
  };
}

/**
 * Early-return refund. Customer returns before the scheduled return; staff
 * optionally refunds the unused whole days at the daily rate (plus any
 * per-day addons + insurance the customer also won't use), minus an admin
 * fee. Always staff-gated — the calculator returns an offer, never applies
 * it automatically.
 *
 * Unused days = floor((scheduled − actual) / 24h). Returning 23 hours
 * early yields 0 unused days — matches the cancellation policy's
 * "whole-day" framing and avoids tiny awkward refunds.
 *
 * Returns `{ unusedDays: 0, refund: 0 }` when:
 *   - actualReturn >= scheduledReturn (on-time or late)
 *   - unusedDays < EARLY_RETURN_POLICY.minUnusedDays (threshold)
 *
 * Callers should short-circuit on `refund === 0` and not surface the
 * action to staff — no point asking a human to approve a zero refund.
 */
export function calcEarlyReturnRefund(args: {
  scheduledReturn: Date;
  actualReturn: Date;
  dailyRate: number;
  perDayAddonsTotal?: number;
  perDayInsuranceRate?: number;
  adminFee?: number;
  minUnusedDays?: number;
}): { unusedDays: number; refund: number; adminFee: number } {
  const minUnused = args.minUnusedDays ?? EARLY_RETURN_POLICY.minUnusedDays;
  const adminFee = args.adminFee ?? EARLY_RETURN_POLICY.adminFee;
  const unusedHours =
    (args.scheduledReturn.getTime() - args.actualReturn.getTime()) / 3_600_000;
  const unusedDays = Math.floor(unusedHours / 24);
  if (unusedDays < minUnused) {
    return { unusedDays: Math.max(0, unusedDays), refund: 0, adminFee: 0 };
  }
  const perDay = aud(args.dailyRate)
    .plus(aud(args.perDayAddonsTotal ?? 0))
    .plus(aud(args.perDayInsuranceRate ?? 0));
  const gross = times(perDay, unusedDays);
  const feeDec = gross.lessThan(adminFee) ? gross : aud(adminFee);
  return {
    unusedDays,
    refund: toNumber(roundCents(gross.minus(feeDec))),
    adminFee: toNumber(feeDec),
  };
}
