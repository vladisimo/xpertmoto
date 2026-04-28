import type { LoyaltyTier, PrismaClient } from "@prisma/client";

/**
 * Lever 9: loyalty tier + ledger service.
 *
 * Tier thresholds are on lifetime points:
 *   SILVER   : 0
 *   GOLD     : 2000
 *   PLATINUM : 10000
 *
 * Points:
 *   - EARN: 1 per $1 spent (booking totalAmount, flooring to whole pts)
 *   - EARN: 500 bonus for posting a review (status = APPROVED)
 *   - EARN: 1000 bonus when a referral qualifies
 *   - BURN: 100 pts = A$1 discount at booking
 *
 * Tier perks:
 *   GOLD   — -20% bond, free helmet, priority upgrade
 *   PLATINUM — $0 bond, free delivery, free excess reduction (auto
 *              Premium insurance attached at booking), exclusive weekend
 *              slot access
 */

export const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  SILVER: 0,
  GOLD: 2000,
  PLATINUM: 10000,
};

export const POINTS_PER_DOLLAR = 1;
export const POINTS_PER_REVIEW = 500;
export const POINTS_PER_REFERRAL = 1000;
export const BURN_POINTS_PER_DOLLAR = 100;

export function tierForPoints(lifetimePoints: number): LoyaltyTier {
  if (lifetimePoints >= TIER_THRESHOLDS.PLATINUM) return "PLATINUM";
  if (lifetimePoints >= TIER_THRESHOLDS.GOLD) return "GOLD";
  return "SILVER";
}

export function tierBondMultiplier(tier: LoyaltyTier): number {
  switch (tier) {
    case "PLATINUM":
      return 0; // $0 bond
    case "GOLD":
      return 0.8;
    default:
      return 1;
  }
}

export type AwardLoyaltyPointsInput = {
  userId: string;
  bookingId?: string;
  points: number;
  reason: string;
  expiresAt?: Date | null;
};

export async function awardLoyaltyPoints(
  prisma: PrismaClient,
  input: AwardLoyaltyPointsInput,
): Promise<number> {
  if (input.points <= 0) return 0;

  // Dedupe by (userId, bookingId, reason) if a bookingId is provided so
  // replayed jobs don't double-award.
  if (input.bookingId) {
    const existing = await prisma.loyaltyLedger.findFirst({
      where: {
        userId: input.userId,
        bookingId: input.bookingId,
        direction: "EARN",
        reason: input.reason,
      },
    });
    if (existing) return 0;
  }

  return prisma.$transaction(async (tx) => {
    await tx.loyaltyLedger.create({
      data: {
        userId: input.userId,
        bookingId: input.bookingId,
        direction: "EARN",
        points: input.points,
        reason: input.reason,
        expiresAt: input.expiresAt,
      },
    });

    const profile = await tx.customerProfile.update({
      where: { userId: input.userId },
      data: {
        loyaltyPoints: { increment: input.points },
        lifetimePoints: { increment: input.points },
      },
    });

    const newTier = tierForPoints(profile.lifetimePoints);
    if (newTier !== profile.loyaltyTier) {
      await tx.customerProfile.update({
        where: { userId: input.userId },
        data: { loyaltyTier: newTier },
      });
    }

    return input.points;
  });
}

export type BurnLoyaltyPointsInput = {
  userId: string;
  bookingId: string;
  points: number;
  reason?: string;
};

/**
 * Convert loyalty points into a booking discount amount. Returns the
 * dollar credit applied. Throws if balance insufficient.
 */
export async function burnLoyaltyPoints(
  prisma: PrismaClient,
  input: BurnLoyaltyPointsInput,
): Promise<number> {
  const profile = await prisma.customerProfile.findUniqueOrThrow({
    where: { userId: input.userId },
  });
  if (profile.loyaltyPoints < input.points) {
    throw new Error(
      `Insufficient loyalty points (balance ${profile.loyaltyPoints}, requested ${input.points})`,
    );
  }
  const dollarCredit = Math.round((input.points / BURN_POINTS_PER_DOLLAR) * 100) / 100;
  await prisma.$transaction(async (tx) => {
    await tx.loyaltyLedger.create({
      data: {
        userId: input.userId,
        bookingId: input.bookingId,
        direction: "BURN",
        points: input.points,
        reason: input.reason ?? `Burn ${input.points}pts on booking`,
      },
    });
    await tx.customerProfile.update({
      where: { userId: input.userId },
      data: { loyaltyPoints: { decrement: input.points } },
    });
  });
  return dollarCredit;
}
