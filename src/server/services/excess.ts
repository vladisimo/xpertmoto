import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";

type PrismaLike = PrismaClient | typeof defaultPrisma;

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Where the effective excess figure came from — surfaced in the staff UI. */
export type ExcessSource = "BOOKING_INSURANCE" | "DEFAULT_OPTION" | "SETTING";

export type BookingExcess = {
  /** The per-hire damage-liability cap in AUD. */
  excess: number;
  source: ExcessSource;
  /** Insurance product name backing the figure (null for the setting fallback). */
  tierName: string | null;
};

/**
 * Resolve the customer's damage-liability excess for a booking.
 *
 * Ladder (per the excess-cap remediation plan):
 *   1. Lowest `excessAmountSnapshot` across the booking's BookingInsurance
 *      rows — mid-rental upgrades attach a second row, and the customer gets
 *      the best (lowest) excess they paid for. Rows missing a snapshot
 *      (pre-backfill edge) fall back to their option's live excessAmount.
 *   2. No insurance on the booking → the active isDefault InsuranceOption's
 *      excessAmount (what the customer implicitly hires under).
 *   3. No default option configured → the `insurance.defaultExcessAmount`
 *      system setting.
 */
export async function getBookingExcess(
  prisma: PrismaLike,
  bookingId: string,
): Promise<BookingExcess> {
  const rows = await prisma.bookingInsurance.findMany({
    where: { bookingId },
    include: { insuranceOption: { select: { name: true, excessAmount: true } } },
  });
  if (rows.length > 0) {
    let best: { excess: number; tierName: string } | null = null;
    for (const row of rows) {
      const effective = Number(
        row.excessAmountSnapshot ?? row.insuranceOption.excessAmount,
      );
      if (!Number.isFinite(effective)) continue;
      if (!best || effective < best.excess) {
        best = { excess: r2(effective), tierName: row.insuranceOption.name };
      }
    }
    if (best) {
      return { excess: best.excess, source: "BOOKING_INSURANCE", tierName: best.tierName };
    }
  }

  const defaultOption = await prisma.insuranceOption.findFirst({
    where: { isDefault: true, isActive: true },
    select: { name: true, excessAmount: true },
  });
  if (defaultOption) {
    return {
      excess: r2(Number(defaultOption.excessAmount)),
      source: "DEFAULT_OPTION",
      tierName: defaultOption.name,
    };
  }

  const fallback = await getSetting(
    "insurance.defaultExcessAmount",
    SETTING_DEFAULTS["insurance.defaultExcessAmount"],
  );
  return { excess: r2(Number(fallback)), source: "SETTING", tierName: null };
}

/**
 * How much of the excess this hire has already consumed, in AUD.
 *
 * PER-HIRE AGGREGATE (user-locked decision): every damage recovery on the
 * booking counts against the one cap — return-assessment lines, quote
 * close-outs, and incident charges together.
 *
 * Composition:
 *   + DamageCharge rows — parented by the booking's return assessments OR
 *     (since the damage surface unified) by an incident linked to the
 *     booking — in CONFIRMED | CAPTURED. `amount` is the customer's
 *     liability for the line whether it was bond-funded or card-charged.
 *   + Damage-recovery Payment rows in PENDING | SUCCEEDED that have NO
 *     DamageCharge row of their own — the fallback for flows that record
 *     the recovery only as a Payment. Anything already linked from a
 *     DamageCharge.capturedPaymentId is deduped out (those charges' amounts
 *     were counted above). Families:
 *       - DAMAGE_CHARGE `INC-%` — historical incident charges raised before
 *         the unification (post-unification slices carry a charge row and
 *         are deduped via the link).
 *       - DAMAGE_CHARGE `DMG-%` — quick check-in's ad-hoc `DMG-<timestamp>`
 *         card charges have no charge row (counted); finalise / close-out
 *         `DMG-<chargeId>` rows ARE linked (deduped).
 *       - DAMAGE_CHARGE `BOND-CAP-OVF-%` — settlement-console bond-capture
 *         overflow billed to the card.
 *       - BOND_CAPTURE `BOND-CAP-%` — manual settlement-console captures and
 *         quick check-in's damage bond slice (`BOND-CAP-<timestamp>`), which
 *         are damage recoveries with no charge row. EXCLUDES
 *         `BOND-CAP-RET-%` (finalise's combined capture also funds
 *         late/fuel/cleaning, and its damage share already lives on the
 *         assessment's DamageCharge rows) and `BOND-CAP-NOSHOW-%` (a
 *         no-show fee, not damage).
 *   − REFUND rows (PENDING | SUCCEEDED) whose parent is any DAMAGE_CHARGE
 *     or BOND_CAPTURE payment on the booking — a refunded recovery frees
 *     the cap back up.
 */
export async function getDamageLiabilityUsed(
  prisma: PrismaLike,
  bookingId: string,
): Promise<number> {
  const charges = await prisma.damageCharge.findMany({
    where: {
      OR: [{ returnAssessment: { bookingId } }, { incident: { bookingId } }],
      status: { in: ["CONFIRMED", "CAPTURED"] },
    },
    select: { amount: true, capturedPaymentId: true },
  });
  const chargesTotal = charges.reduce((acc, c) => acc + Number(c.amount), 0);
  const linkedPaymentIds = new Set(
    charges.map((c) => c.capturedPaymentId).filter((id): id is string => !!id),
  );

  const recoveryPayments = await prisma.payment.findMany({
    where: {
      bookingId,
      status: { in: ["PENDING", "SUCCEEDED"] },
      deletedAt: null,
      OR: [
        { type: "DAMAGE_CHARGE", reference: { startsWith: "INC-" } },
        { type: "DAMAGE_CHARGE", reference: { startsWith: "DMG-" } },
        { type: "DAMAGE_CHARGE", reference: { startsWith: "BOND-CAP-OVF-" } },
        {
          type: "BOND_CAPTURE",
          reference: { startsWith: "BOND-CAP-" },
          NOT: [
            { reference: { startsWith: "BOND-CAP-RET-" } },
            { reference: { startsWith: "BOND-CAP-NOSHOW-" } },
          ],
        },
      ],
    },
    select: { id: true, amount: true },
  });
  const recoveredTotal = recoveryPayments
    .filter((p) => !linkedPaymentIds.has(p.id))
    .reduce((acc, p) => acc + Number(p.amount), 0);

  const refunds = await prisma.payment.findMany({
    where: {
      bookingId,
      type: "REFUND",
      status: { in: ["PENDING", "SUCCEEDED"] },
      parentPayment: { type: { in: ["DAMAGE_CHARGE", "BOND_CAPTURE"] } },
      deletedAt: null,
    },
    select: { amount: true },
  });
  const refundTotal = refunds.reduce((acc, p) => acc + Number(p.amount), 0);

  return Math.max(0, r2(chargesTotal + recoveredTotal - refundTotal));
}

export type ExcessCapResult = {
  /** What may actually be charged after the cap. */
  chargeable: number;
  /** How much the cap shaved off the proposed amount (0 when uncapped). */
  cappedBy: number;
  /** Cap headroom BEFORE this charge (excess − used, floored at 0). */
  capRemaining: number;
};

/**
 * Clamp a proposed damage charge to the hire's remaining excess headroom.
 * Pure — callers accumulate `used` across sequential lines themselves
 * (used += chargeable) so a multi-line assessment consumes the cap in
 * creation order. `voided` (incident-level manager void) and
 * `managerOverride` (per-charge override) lift the cap entirely but still
 * report the headroom for the audit trail.
 */
export function applyExcessCap(args: {
  proposed: number;
  used: number;
  excess: number;
  voided?: boolean;
  managerOverride?: boolean;
}): ExcessCapResult {
  const proposed = r2(Math.max(0, args.proposed));
  const capRemaining = r2(Math.max(0, args.excess - args.used));
  if (args.voided || args.managerOverride) {
    return { chargeable: proposed, cappedBy: 0, capRemaining };
  }
  const chargeable = r2(Math.min(proposed, capRemaining));
  return { chargeable, cappedBy: r2(proposed - chargeable), capRemaining };
}
