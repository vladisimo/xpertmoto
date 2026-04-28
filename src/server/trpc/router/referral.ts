import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../trpc";
import { applyReferral, ensureReferralCode } from "@/server/services/referral";

export const referralRouter = createTRPCRouter({
  myCode: protectedProcedure.query(async ({ ctx }) => {
    const code = await ensureReferralCode(ctx.prisma, ctx.user.id);
    const profile = await ctx.prisma.customerProfile.findUnique({
      where: { userId: ctx.user.id },
      select: { referralCreditBalance: true },
    });
    const referrals = await ctx.prisma.referral.groupBy({
      by: ["status"],
      where: { referrerId: ctx.user.id },
      _count: { _all: true },
    });
    return {
      code,
      creditBalance: Number(profile?.referralCreditBalance ?? 0),
      referrals: referrals.reduce(
        (acc, r) => ({ ...acc, [r.status]: r._count._all }),
        {} as Record<string, number>,
      ),
    };
  }),

  lookup: publicProcedure
    .input(z.object({ code: z.string().min(3) }))
    .query(async ({ ctx, input }) => {
      const profile = await ctx.prisma.customerProfile.findUnique({
        where: { referralCode: input.code },
        include: { user: { select: { firstName: true } } },
      });
      if (!profile) return null;
      return {
        referrerFirstName: profile.user.firstName,
        valid: true,
      };
    }),

  applyCode: protectedProcedure
    .input(
      z.object({
        code: z.string(),
        bookingId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return applyReferral(ctx.prisma, {
        code: input.code,
        refereeId: ctx.user.id,
        refereeEmail: ctx.user.email ?? undefined,
        bookingId: input.bookingId,
      });
    }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.referral.findMany({
      where: { referrerId: ctx.user.id },
      include: {
        referee: { select: { firstName: true, lastName: true } },
        qualifyingBooking: { select: { bookingReference: true, totalAmount: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }),
});
