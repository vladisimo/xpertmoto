import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure, staffProcedure } from "../trpc";

export const damageTariffRouter = createTRPCRouter({
  /** Staff-facing: list active tariffs, optionally filtered by category. */
  list: staffProcedure
    .input(
      z
        .object({
          activeOnly: z.boolean().optional(),
          categoryId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const tariffs = await ctx.prisma.damageTariff.findMany({
        where: {
          ...(input?.activeOnly === false ? {} : { isActive: true }),
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      });
      if (!input?.categoryId) return tariffs;
      return tariffs.filter((t) => t.categoryScope.length === 0 || t.categoryScope.includes(input.categoryId!));
    }),

  /** Admin CRUD. */
  upsert: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        code: z.string().min(2).max(40),
        name: z.string().min(1),
        description: z.string().optional(),
        defaultPrice: z.number().min(0),
        categoryScope: z.array(z.string()).default([]),
        severityHint: z.enum(["MINOR", "MODERATE", "MAJOR"]).optional(),
        isActive: z.boolean().default(true),
        displayOrder: z.number().int().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        return ctx.prisma.damageTariff.update({
          where: { id: input.id },
          data: {
            code: input.code,
            name: input.name,
            description: input.description,
            defaultPrice: input.defaultPrice,
            categoryScope: input.categoryScope,
            severityHint: input.severityHint,
            isActive: input.isActive,
            displayOrder: input.displayOrder,
          },
        });
      }
      const duplicate = await ctx.prisma.damageTariff.findUnique({
        where: { code: input.code },
      });
      if (duplicate) {
        throw new TRPCError({ code: "CONFLICT", message: `Tariff code "${input.code}" already exists` });
      }
      return ctx.prisma.damageTariff.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          defaultPrice: input.defaultPrice,
          categoryScope: input.categoryScope,
          severityHint: input.severityHint,
          isActive: input.isActive,
          displayOrder: input.displayOrder,
        },
      });
    }),

  disable: adminProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.prisma.damageTariff.update({
      where: { id: input.id },
      data: { isActive: false },
    }),
  ),

  enable: adminProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.prisma.damageTariff.update({
      where: { id: input.id },
      data: { isActive: true },
    }),
  ),
});
