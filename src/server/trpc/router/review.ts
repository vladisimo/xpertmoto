import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  adminProcedure,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../trpc";
import { awardLoyaltyPoints } from "@/server/services/loyalty";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { writeAudit } from "@/server/services/audit";

/**
 * Lever 5: review capture + moderation + public display.
 *
 * - Customers submit once per booking (unique on bookingId). Status
 *   starts PENDING; staff moderate to APPROVED or REJECTED.
 * - Approved reviews show on homepage/fleet pages and can be
 *   syndicated to Trustpilot / Google via a separate integration job
 *   (uses `syndicatedTo[]` to dedupe).
 * - Writing a review (once approved) mints a 500-point loyalty bonus.
 */
export const reviewRouter = createTRPCRouter({
  submit: protectedProcedure
    .input(
      z.object({
        bookingId: z.string(),
        rating: z.number().int().min(1).max(5),
        title: z.string().max(120).optional(),
        body: z.string().max(2000).optional(),
        photos: z.array(z.string().url()).max(6).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
        include: { category: true, pickupDepot: true },
      });
      if (booking.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (booking.status !== "COMPLETED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reviews can only be left on completed bookings",
        });
      }
      const existing = await ctx.prisma.review.findUnique({
        where: { bookingId: booking.id },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You've already reviewed this booking",
        });
      }

      const review = await ctx.prisma.review.create({
        data: {
          bookingId: booking.id,
          customerId: ctx.user.id,
          rating: input.rating,
          title: input.title,
          body: input.body,
          photos: input.photos ?? [],
          status: "PENDING",
          syndicatedTo: [],
          vehicleCategoryId: booking.categoryId,
          depotId: booking.pickupDepotId,
        },
      });

      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        action: "REVIEW_SUBMITTED",
        entity: "Review",
        entityId: review.id,
        newData: { rating: input.rating, bookingId: booking.id },
      });

      return review;
    }),

  moderate: adminProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["APPROVED", "HIDDEN", "REJECTED"]),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const review = await ctx.prisma.review.update({
        where: { id: input.id },
        data: {
          status: input.status,
          moderatedById: ctx.user.id,
          moderatedAt: new Date(),
          publishedAt: input.status === "APPROVED" ? new Date() : null,
        },
      });

      if (input.status === "APPROVED") {
        const pointsPerReview = await getSetting(
          "loyalty.pointsPerReview",
          SETTING_DEFAULTS["loyalty.pointsPerReview"],
        );
        await awardLoyaltyPoints(ctx.prisma, {
          userId: review.customerId,
          points: pointsPerReview,
          reason: `Approved review ${review.id}`,
        });
      }

      return review;
    }),

  listPublished: publicProcedure
    .input(
      z
        .object({
          categoryId: z.string().optional(),
          depotId: z.string().optional(),
          take: z.number().min(1).max(50).default(12),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const args = input ?? { take: 12 };
      return ctx.prisma.review.findMany({
        where: {
          status: "APPROVED",
          ...(args.categoryId ? { vehicleCategoryId: args.categoryId } : {}),
          ...(args.depotId ? { depotId: args.depotId } : {}),
        },
        include: {
          customer: { select: { firstName: true, lastName: true } },
          category: { select: { name: true } },
        },
        orderBy: { publishedAt: "desc" },
        take: args.take,
      });
    }),

  aggregateStats: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.review.groupBy({
      by: ["rating"],
      where: { status: "APPROVED" },
      _count: { _all: true },
    });
    const total = rows.reduce((acc, r) => acc + r._count._all, 0);
    if (total === 0) {
      return { total: 0, average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    }
    let sum = 0;
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of rows) {
      sum += r.rating * r._count._all;
      distribution[r.rating] = r._count._all;
    }
    return { total, average: Math.round((sum / total) * 100) / 100, distribution };
  }),

  moderationQueue: adminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.review.findMany({
      where: { status: "PENDING" },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  }),
});
