import {
  Prisma,
  type PrismaClient,
  type PaymentType,
  type BookingStatus,
  type LoyaltyTier,
} from "@prisma/client";
import type { Prisma as P } from "@prisma/client";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { tierForPoints } from "./loyalty";

/**
 * Customer rewards aggregation — the single source of truth for the
 * denormalised CustomerProfile counters that drive the loyalty leaderboard
 * and tier.
 *
 * Semantics (confirmed product decisions):
 *  - **Lifetime spend = net money actually collected.** Per booking:
 *      Σ[SUCCEEDED, revenue-inflow types]
 *    + Σ[PARTIALLY_REFUNDED, revenue-inflow types]   (charge stays at full)
 *    − ( Σ[REFUND rows] − Σ[REFUNDED charges, revenue-inflow types] )
 *    Bond *holds/releases* are excluded; a forfeited bond (BOND_CAPTURE) is
 *    real collected money and counts. Summed over all non-cancelled
 *    bookings, so no-show retained fees and in-flight bookings count.
 *  - **Points follow all collected money:** spend points = floor(spend ×
 *    pointsPerDollar). Tier is driven by lifetime points. Review / referral /
 *    admin bonuses stay event-sourced in LoyaltyLedger and are added on top;
 *    burns/expiries reduce the spendable balance.
 *  - **Booking count = completed + current** (in-flight). No-shows and
 *    cancellations don't count as bookings (but their collected money still
 *    counts as spend).
 *
 * This module is the only writer of totalSpend / totalBookings /
 * completedBookings / lastBookingAt / lifetimePoints / loyaltyPoints /
 * loyaltyTier. It is recomputed (absolute values, idempotent) by the nightly
 * rewards-recompute job and at booking completion / no-show. See the
 * `project_booking_completion_invariant` memory.
 */

type Db = PrismaClient | P.TransactionClient;

/**
 * Payment types that represent money collected from the customer. Excludes
 * bond holds/releases (net-zero authorisations), refunds/credits (outflows),
 * gift-card flows, and partner payouts. BOND_CAPTURE is included — a
 * forfeited bond is money the business kept.
 */
export const REVENUE_INFLOW_TYPES: PaymentType[] = [
  "BOOKING_PAYMENT",
  "EXTENSION",
  "ADDON_CHARGE",
  "DAMAGE_CHARGE",
  "LATE_FEE",
  "FUEL_CHARGE",
  "CLEANING_FEE",
  "ZONE_SURCHARGE",
  "FUEL_DELIVERY_FEE",
  "INFRINGEMENT_RECOVERY",
  "MANUAL_CHARGE",
  "SUBSCRIPTION_CHARGE",
  "SWAP_ADJUSTMENT",
  "BOND_CAPTURE",
];

/**
 * Payment types that earn loyalty points — genuine hire spend only. Penalty
 * revenue (damage, late fees, infringement recovery, forfeited bonds,
 * cleaning/fuel penalties, manual/no-show charges) still counts toward
 * lifetime *spend* (money drawn down) but must NOT advance tier — rewarding a
 * customer for incurring penalties isn't intended.
 */
export const POINTS_ELIGIBLE_TYPES: PaymentType[] = [
  "BOOKING_PAYMENT",
  "EXTENSION",
  "ADDON_CHARGE",
  "ZONE_SURCHARGE",
  "FUEL_DELIVERY_FEE",
  "SUBSCRIPTION_CHARGE",
  "SWAP_ADJUSTMENT",
];

/** In-flight bookings — engagements underway but not yet completed. */
export const CURRENT_BOOKING_STATUSES: BookingStatus[] = [
  "CONFIRMED",
  "CHECKED_OUT",
  "ACTIVE",
  "OVERDUE",
  "RETURNED",
];

type PaymentRow = {
  id: string;
  type: PaymentType;
  status: string;
  amount: Prisma.Decimal;
  parentPaymentId: string | null;
};

/**
 * Net money collected for a set of payment rows, restricted to `types`
 * (default: all revenue inflows → lifetime spend; pass POINTS_ELIGIBLE_TYPES
 * for points). See module doc for the formula.
 *
 * Refund handling is attribution-based: a REFUND row carries no PaymentType,
 * so we link it to the charge it reverses via `parentPaymentId` (set by the
 * refund flows) and attribute it to that charge's type/status. A partial
 * refund only reduces a pass it actually belongs to — so a partial refund of
 * a non-points charge no longer erodes the points-eligible total. A full
 * refund nets to zero (the REFUNDED charge is already excluded from the
 * positive total, and its linked refund is not subtracted again).
 *
 * Legacy REFUND rows with no `parentPaymentId` fall back to the prior global
 * approximation (subtract the unlinked pool, offset by unlinked full refunds
 * across all inflow) — unchanged behavior for pre-migration data. Clamped at
 * zero.
 */
export function computeNetCollected(
  payments: PaymentRow[],
  types: PaymentType[] = REVENUE_INFLOW_TYPES,
): Prisma.Decimal {
  const allInflow = new Set<PaymentType>(REVENUE_INFLOW_TYPES);
  const selected = new Set<PaymentType>(types);

  // Index charges so a REFUND row can be resolved to its source charge's
  // type + status. Only non-REFUND rows are charges.
  const chargeById = new Map<string, { type: PaymentType; status: string }>();
  for (const p of payments) {
    if (p.type !== "REFUND") chargeById.set(p.id, { type: p.type, status: p.status });
  }

  let succeeded = new Prisma.Decimal(0);
  let partiallyRefunded = new Prisma.Decimal(0);
  // Partial refunds precisely attributed to a selected charge.
  let linkedRefundsSelected = new Prisma.Decimal(0);
  // Legacy refunds with no resolvable source link.
  let unlinkedRefundRows = new Prisma.Decimal(0);
  // Source charges whose refund we attributed precisely — excluded from the
  // legacy full-refund offset so a linked full refund isn't double-counted.
  const linkedSourceIds = new Set<string>();

  for (const p of payments) {
    if (p.type === "REFUND") {
      if (p.status !== "SUCCEEDED") continue;
      const src = p.parentPaymentId ? chargeById.get(p.parentPaymentId) : undefined;
      if (src) {
        linkedSourceIds.add(p.parentPaymentId!);
        // Subtract only partial refunds of selected charges. A fully-refunded
        // source is already excluded from the positive total, so subtracting
        // its refund too would double-count.
        if (src.status === "PARTIALLY_REFUNDED" && selected.has(src.type)) {
          linkedRefundsSelected = linkedRefundsSelected.add(p.amount);
        }
        continue;
      }
      unlinkedRefundRows = unlinkedRefundRows.add(p.amount);
      continue;
    }
    if (!allInflow.has(p.type)) continue;
    if (!selected.has(p.type)) continue;
    if (p.status === "SUCCEEDED") succeeded = succeeded.add(p.amount);
    else if (p.status === "PARTIALLY_REFUNDED") partiallyRefunded = partiallyRefunded.add(p.amount);
  }

  // Legacy offset: full-refund flips of any inflow type cancel their unlinked
  // REFUND row (prior global behavior), excluding charges we already
  // attributed precisely above.
  let refundedUnlinkedInflow = new Prisma.Decimal(0);
  for (const p of payments) {
    if (p.type === "REFUND" || !allInflow.has(p.type)) continue;
    if (p.status === "REFUNDED" && !linkedSourceIds.has(p.id)) {
      refundedUnlinkedInflow = refundedUnlinkedInflow.add(p.amount);
    }
  }
  const legacyNetRefunds = Prisma.Decimal.max(unlinkedRefundRows.sub(refundedUnlinkedInflow), 0);

  const net = succeeded.add(partiallyRefunded).sub(linkedRefundsSelected).sub(legacyNetRefunds);
  return Prisma.Decimal.max(net, 0);
}

export type RewardsSnapshot = {
  totalSpend: Prisma.Decimal;
  completedBookings: number;
  totalBookings: number;
  lastBookingAt: Date | null;
  lifetimePoints: number;
  loyaltyPoints: number;
  loyaltyTier: LoyaltyTier;
};

/**
 * Derive a customer's rewards snapshot from source ledgers. Pure read — does
 * not write. Spend points are derived from net collected; review/referral/
 * admin bonuses (any EARN ledger row not tagged as booking spend) are added
 * on top; burns + expiries reduce the spendable balance.
 */
export async function computeCustomerRewards(db: Db, userId: string): Promise<RewardsSnapshot> {
  const bookings = await db.booking.findMany({
    where: { customerId: userId },
    select: {
      id: true,
      status: true,
      pickupDateTime: true,
      actualReturnDateTime: true,
      createdAt: true,
    },
  });

  // Spend: net collected across all non-cancelled bookings.
  const spendBookingIds = bookings.filter((b) => b.status !== "CANCELLED").map((b) => b.id);
  const payments = spendBookingIds.length
    ? await db.payment.findMany({
        where: { bookingId: { in: spendBookingIds } },
        select: { id: true, type: true, status: true, amount: true, parentPaymentId: true },
      })
    : [];
  // Lifetime spend = all money drawn down (incl. penalties). Points only
  // accrue on genuine hire spend — penalties count as spend but don't earn.
  const totalSpend = computeNetCollected(payments as PaymentRow[]);
  const pointsEligibleSpend = computeNetCollected(payments as PaymentRow[], POINTS_ELIGIBLE_TYPES);

  // Counts: completed + current (in-flight). No-shows / cancellations excluded.
  const current = new Set<BookingStatus>(CURRENT_BOOKING_STATUSES);
  const completedBookings = bookings.filter((b) => b.status === "COMPLETED").length;
  const countedBookings = bookings.filter(
    (b) => b.status === "COMPLETED" || current.has(b.status),
  );
  const totalBookings = countedBookings.length;

  let lastBookingAt: Date | null = null;
  for (const b of countedBookings) {
    const when = b.actualReturnDateTime ?? b.pickupDateTime ?? b.createdAt;
    if (when && (lastBookingAt === null || when > lastBookingAt)) lastBookingAt = when;
  }

  // Points: spend-derived + non-spend bonuses, less burns/expiries.
  const pointsPerDollar = await getSetting(
    "loyalty.pointsPerDollar",
    SETTING_DEFAULTS["loyalty.pointsPerDollar"],
  );
  const spendPoints = Math.floor(pointsEligibleSpend.toNumber() * pointsPerDollar);

  const ledger = await db.loyaltyLedger.findMany({
    where: { userId },
    select: { direction: true, points: true, reason: true },
  });
  let bonusPoints = 0;
  let burnedPoints = 0;
  for (const e of ledger) {
    if (e.direction === "EARN") {
      // Legacy per-booking spend rows ("Booking <ref>") are superseded by the
      // derived spend points above — don't double-count them as bonuses.
      if (!e.reason.startsWith("Booking ")) bonusPoints += e.points;
    } else if (e.direction === "ADJUSTMENT") {
      bonusPoints += e.points; // signed manual adjustment
    } else if (e.direction === "BURN" || e.direction === "EXPIRY") {
      burnedPoints += e.points;
    }
  }

  const lifetimePoints = Math.max(0, spendPoints + bonusPoints);
  const loyaltyPoints = Math.max(0, lifetimePoints - burnedPoints);
  const loyaltyTier = tierForPoints(lifetimePoints);

  return {
    totalSpend,
    completedBookings,
    totalBookings,
    lastBookingAt,
    lifetimePoints,
    loyaltyPoints,
    loyaltyTier,
  };
}

/** Write a previously-computed snapshot to the profile. Idempotent. */
export async function applyCustomerRewards(
  db: Db,
  userId: string,
  snap: RewardsSnapshot,
): Promise<void> {
  await db.customerProfile.updateMany({
    where: { userId },
    data: {
      totalSpend: snap.totalSpend,
      totalBookings: snap.totalBookings,
      completedBookings: snap.completedBookings,
      lastBookingAt: snap.lastBookingAt,
      lifetimePoints: snap.lifetimePoints,
      loyaltyPoints: snap.loyaltyPoints,
      loyaltyTier: snap.loyaltyTier,
    },
  });
}

/** Compute + write a single customer's rewards. */
export async function recomputeCustomerRewards(db: Db, userId: string): Promise<RewardsSnapshot> {
  const snap = await computeCustomerRewards(db, userId);
  await applyCustomerRewards(db, userId, snap);
  return snap;
}

/**
 * Recompute every customer that could be non-zero — anyone with a booking or
 * a loyalty-ledger entry. Customers with neither are already all-zero.
 */
export async function recomputeAllCustomerRewards(
  db: Db,
  onEach?: (userId: string, snap: RewardsSnapshot) => void,
): Promise<number> {
  const [bookingCustomers, ledgerUsers] = await Promise.all([
    db.booking.findMany({ distinct: ["customerId"], select: { customerId: true } }),
    db.loyaltyLedger.findMany({ distinct: ["userId"], select: { userId: true } }),
  ]);
  const ids = new Set<string>();
  for (const b of bookingCustomers) ids.add(b.customerId);
  for (const l of ledgerUsers) ids.add(l.userId);

  let count = 0;
  for (const userId of ids) {
    const snap = await recomputeCustomerRewards(db, userId);
    onEach?.(userId, snap);
    count += 1;
  }
  return count;
}
