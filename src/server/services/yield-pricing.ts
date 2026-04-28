import type { PrismaClient } from "@prisma/client";

/**
 * Lever 1: yield / demand-based pricing.
 *
 * Computes a per-day × depot × category multiplier to be applied
 * between the seasonal multiplier and the duration discount in the
 * pricing cascade. Multiplier is clamped to [0.85, 1.40] for
 * consumer trust. Reasons codes accompany every recommendation for
 * the admin audit surface.
 *
 * Signals:
 *   - Forward inventory depletion: if 80%+ of fleet at a depot is
 *     already booked for the target date, +15%.
 *   - Days-to-arrival: the closer to pickup, the less negotiable. A
 *     simple bump at <7d (+5%) and <48h (+10%).
 *   - DemandEvent overlap: admin-configured boost/dip windows (e.g.
 *     Splendour weekend +30%, winter weeknight -10%).
 *   - Weekend weighting: Fri/Sat/Sun slots lean +5%.
 */

const MIN_MULTIPLIER = 0.85;
const MAX_MULTIPLIER = 1.4;

export type YieldInputs = {
  depotId: string;
  categoryId: string;
  targetDate: Date;
  now?: Date;
};

export type YieldRecommendation = {
  multiplier: number;
  reasonCodes: string[];
  forwardBookingPct: number;
  demandScore: number;
};

export function clampMultiplier(n: number): number {
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, n));
}

export async function computeRecommendation(
  prisma: PrismaClient,
  input: YieldInputs,
): Promise<YieldRecommendation> {
  const now = input.now ?? new Date();
  const dayStart = new Date(input.targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const reasonCodes: string[] = [];
  let multiplier = 1;
  let demandScore = 0;

  // Forward inventory signal
  const [totalFleet, bookedCount] = await Promise.all([
    prisma.vehicle.count({
      where: { depotId: input.depotId, categoryId: input.categoryId, isActive: true },
    }),
    prisma.booking.count({
      where: {
        depotId: input.depotId,
        categoryId: input.categoryId,
        status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "PENDING_PAYMENT"] },
        pickupDateTime: { lt: dayEnd },
        returnDateTime: { gt: dayStart },
      },
    }),
  ]);
  const utilisation = totalFleet > 0 ? bookedCount / totalFleet : 0;
  demandScore = utilisation;
  if (utilisation >= 0.9) {
    multiplier *= 1.2;
    reasonCodes.push("INVENTORY_90PCT");
  } else if (utilisation >= 0.8) {
    multiplier *= 1.15;
    reasonCodes.push("INVENTORY_80PCT");
  } else if (utilisation >= 0.65) {
    multiplier *= 1.07;
    reasonCodes.push("INVENTORY_65PCT");
  } else if (utilisation < 0.25) {
    multiplier *= 0.92;
    reasonCodes.push("LOW_DEMAND");
  }

  // Days-to-arrival premium
  const hoursAway = (dayStart.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursAway <= 48 && hoursAway >= 0) {
    multiplier *= 1.1;
    reasonCodes.push("SHORT_LEAD_48H");
  } else if (hoursAway <= 7 * 24 && hoursAway > 48) {
    multiplier *= 1.05;
    reasonCodes.push("SHORT_LEAD_7D");
  } else if (hoursAway > 45 * 24) {
    multiplier *= 0.95;
    reasonCodes.push("LONG_LEAD_45D");
  }

  // Weekend weighting: JS getDay Sun=0, Sat=6, Fri=5
  const day = dayStart.getDay();
  if (day === 5 || day === 6 || day === 0) {
    multiplier *= 1.05;
    reasonCodes.push("WEEKEND");
  }

  // DemandEvent overlap
  const events = await prisma.demandEvent.findMany({
    where: {
      isActive: true,
      startDate: { lte: dayEnd },
      endDate: { gte: dayStart },
    },
  });
  for (const e of events) {
    const appliesToDepot = e.depotIds.length === 0 || e.depotIds.includes(input.depotId);
    const appliesToCategory =
      e.categoryIds.length === 0 || e.categoryIds.includes(input.categoryId);
    if (!appliesToDepot || !appliesToCategory) continue;
    const m = Number(e.multiplier);
    multiplier *= m;
    reasonCodes.push(`DEMAND_EVENT:${e.name}`);
  }

  multiplier = clampMultiplier(multiplier);
  multiplier = Math.round(multiplier * 1000) / 1000;

  return { multiplier, reasonCodes, forwardBookingPct: utilisation, demandScore };
}

/**
 * Read back an already-computed recommendation if one was persisted for
 * this day/depot/category, otherwise compute fresh. Used by the pricing
 * quote path so bookings get the same multiplier the admin preview
 * showed.
 */
export async function lookupOrComputeMultiplier(
  prisma: PrismaClient,
  input: YieldInputs,
): Promise<number> {
  const dayStart = new Date(input.targetDate);
  dayStart.setHours(0, 0, 0, 0);

  const saved = await prisma.priceRecommendation.findUnique({
    where: {
      date_depotId_categoryId: {
        date: dayStart,
        depotId: input.depotId,
        categoryId: input.categoryId,
      },
    },
  });
  if (saved && saved.isActive) {
    if (saved.overrideMultiplier !== null) return Number(saved.overrideMultiplier);
    return Number(saved.baseMultiplier);
  }
  const rec = await computeRecommendation(prisma, input);
  return rec.multiplier;
}
