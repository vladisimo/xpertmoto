import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { logger } from "@/lib/logger";

/**
 * Lever 5: referral-code lifecycle.
 *
 * - One immutable referralCode per User (lazy-generated on first ask).
 * - Format: <FIRST-INITIAL><LAST-INITIAL>-<4-CHAR>; e.g. `AL-K9P2`.
 *   If the user has no name, falls back to `RIDE-<6-CHAR>`.
 * - Referral flows: applyReferral (attach pending), qualify (mark
 *   PENDING→QUALIFIED on completed booking), pay (credit referrer).
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferralCode(firstName?: string, lastName?: string): string {
  const prefix =
    firstName && lastName
      ? `${firstName[0]!.toUpperCase()}${lastName[0]!.toUpperCase()}`
      : "RIDE";
  const bytes = randomBytes(4);
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}-${suffix}`;
}

export async function ensureReferralCode(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { customerProfile: true },
  });
  if (user.customerProfile?.referralCode) return user.customerProfile.referralCode;
  if (!user.customerProfile) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "User has no customer profile — cannot assign a referral code",
    });
  }
  // Retry on collision.
  for (let i = 0; i < 5; i += 1) {
    const code = generateReferralCode(user.firstName, user.lastName);
    const exists = await prisma.customerProfile.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!exists) {
      await prisma.customerProfile.update({
        where: { userId },
        data: { referralCode: code },
      });
      return code;
    }
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Could not generate unique referral code after 5 attempts",
  });
}

export type ApplyReferralInput = {
  code: string;
  refereeId?: string;
  refereeEmail?: string;
  bookingId?: string;
};

/**
 * Called at booking-creation time when the referee used a `?ref=` link.
 * Creates a Referral row in PENDING state — discount is applied immediately
 * at the pricing layer (see pricing.ts), but the referrer reward is only
 * paid when the booking actually completes.
 */
export async function applyReferral(
  prisma: PrismaClient,
  input: ApplyReferralInput,
) {
  const referrerProfile = await prisma.customerProfile.findUnique({
    where: { referralCode: input.code },
    select: { userId: true },
  });
  if (!referrerProfile) {
    logger.warn({ code: input.code }, "applyReferral: unknown referral code");
    return null;
  }
  if (referrerProfile.userId === input.refereeId) {
    logger.warn({ code: input.code }, "applyReferral: self-referral blocked");
    return null;
  }

  // Idempotency — if a referral row already exists for (referrer, referee),
  // don't double-create.
  const existing = await prisma.referral.findFirst({
    where: {
      referrerId: referrerProfile.userId,
      OR: [
        input.refereeId ? { refereeId: input.refereeId } : {},
        input.refereeEmail ? { refereeEmail: input.refereeEmail } : {},
      ].filter((x) => Object.keys(x).length > 0),
    },
  });
  if (existing) return existing;

  return prisma.referral.create({
    data: {
      referrerId: referrerProfile.userId,
      refereeId: input.refereeId,
      refereeEmail: input.refereeEmail,
      code: input.code,
      status: "PENDING",
      qualifyingBookingId: input.bookingId,
    },
  });
}

/**
 * Flip PENDING→QUALIFIED when the referee's first booking completes and
 * credit the referrer's referralCreditBalance. Called by the
 * post-trip-review job as part of the completion cascade.
 */
export async function qualifyReferral(
  prisma: PrismaClient,
  args: { refereeId: string; qualifyingBookingId: string },
) {
  const referral = await prisma.referral.findFirst({
    where: { refereeId: args.refereeId, status: "PENDING" },
  });
  if (!referral) return null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: "QUALIFIED",
        qualifiedAt: new Date(),
        qualifyingBookingId: args.qualifyingBookingId,
      },
    });
    await tx.customerProfile.update({
      where: { userId: referral.referrerId },
      data: {
        referralCreditBalance: { increment: Number(referral.rewardAmount) },
      },
    });
    return updated;
  });
}
