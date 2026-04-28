import { z } from "zod";
import {
  adminProcedure,
  createTRPCRouter,
  managerProcedure,
} from "../trpc";
import { computeRecommendation } from "@/server/services/yield-pricing";

/**
 * Lever 1: admin surface for yield-pricing recommendations and demand
 * events. Day-to-day pricing is computed live; this router lets admins
 * override a single (date, depot, category) slot and manage the
 * DemandEvent calendar.
 */
export const yieldPricingRouter = createTRPCRouter({
  listRecommendations: managerProcedure
    .input(
      z.object({
        depotId: z.string().optional(),
        from: z.coerce.date(),
        to: z.coerce.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.priceRecommendation.findMany({
        where: {
          ...(input.depotId ? { depotId: input.depotId } : {}),
          date: { gte: input.from, lte: input.to },
        },
        orderBy: [{ date: "asc" }, { depotId: "asc" }, { categoryId: "asc" }],
      });
    }),

  preview: managerProcedure
    .input(
      z.object({
        depotId: z.string(),
        categoryId: z.string(),
        targetDate: z.coerce.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return computeRecommendation(ctx.prisma, input);
    }),

  override: adminProcedure
    .input(
      z.object({
        depotId: z.string(),
        categoryId: z.string(),
        date: z.coerce.date(),
        multiplier: z.number().min(0.5).max(2),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const date = new Date(input.date);
      date.setHours(0, 0, 0, 0);
      return ctx.prisma.priceRecommendation.upsert({
        where: {
          date_depotId_categoryId: {
            date,
            depotId: input.depotId,
            categoryId: input.categoryId,
          },
        },
        update: {
          overrideMultiplier: input.multiplier,
          overriddenById: ctx.user.id,
          overriddenAt: new Date(),
          isActive: true,
        },
        create: {
          date,
          depotId: input.depotId,
          categoryId: input.categoryId,
          baseMultiplier: input.multiplier,
          overrideMultiplier: input.multiplier,
          overriddenById: ctx.user.id,
          overriddenAt: new Date(),
          reasonCodes: ["ADMIN_OVERRIDE"],
          isActive: true,
        },
      });
    }),

  listDemandEvents: managerProcedure.query(async ({ ctx }) => {
    return ctx.prisma.demandEvent.findMany({
      orderBy: { startDate: "asc" },
    });
  }),

  upsertDemandEvent: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(2),
        description: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        multiplier: z.number().min(0.5).max(2),
        impact: z.enum(["BOOST", "DIP"]).default("BOOST"),
        depotIds: z.array(z.string()).default([]),
        categoryIds: z.array(z.string()).default([]),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      if (id) {
        return ctx.prisma.demandEvent.update({ where: { id }, data });
      }
      return ctx.prisma.demandEvent.create({
        data: { ...data, createdById: ctx.user.id },
      });
    }),
});
