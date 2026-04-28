import { z } from "zod";
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
} from "../trpc";
import {
  awardLoyaltyPoints,
  burnLoyaltyPoints,
  BURN_POINTS_PER_DOLLAR,
  TIER_THRESHOLDS,
} from "@/server/services/loyalty";

export const loyaltyRouter = createTRPCRouter({
  myBalance: protectedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.prisma.customerProfile.findUnique({
      where: { userId: ctx.user.id },
      select: {
        loyaltyPoints: true,
        lifetimePoints: true,
        loyaltyTier: true,
      },
    });
    if (!profile) return null;
    const tier = profile.loyaltyTier;
    const nextTier =
      tier === "SILVER" ? "GOLD" : tier === "GOLD" ? "PLATINUM" : null;
    const nextThreshold = nextTier ? TIER_THRESHOLDS[nextTier] : null;
    return {
      points: profile.loyaltyPoints,
      lifetimePoints: profile.lifetimePoints,
      tier,
      nextTier,
      pointsToNextTier: nextThreshold
        ? Math.max(0, nextThreshold - profile.lifetimePoints)
        : null,
      centsPerPoint: Math.round((1 / BURN_POINTS_PER_DOLLAR) * 100),
    };
  }),

  myLedger: protectedProcedure
    .input(
      z
        .object({ take: z.number().min(1).max(200).default(50) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.loyaltyLedger.findMany({
        where: { userId: ctx.user.id },
        include: {
          booking: { select: { bookingReference: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input?.take ?? 50,
      });
    }),

  redeem: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        points: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return burnLoyaltyPoints(ctx.prisma, {
        userId: ctx.user.id,
        bookingId: input.bookingId,
        points: input.points,
      });
    }),

  adminAward: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        points: z.number().int().positive(),
        reason: z.string().min(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return awardLoyaltyPoints(ctx.prisma, {
        userId: input.userId,
        points: input.points,
        reason: `Admin award: ${input.reason}`,
      });
    }),
});
