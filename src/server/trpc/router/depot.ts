import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { getForecast } from "@/lib/weather";
import { cached } from "@/lib/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const depotRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) =>
    cached(
      "depot:list:active",
      3600,
      () =>
        ctx.prisma.depot.findMany({
          where: { isActive: true, deletedAt: null },
          orderBy: { name: "asc" },
          include: { operatingHours: true },
        }),
      [CACHE_TAGS.DEPOTS],
    ),
  ),

  forecast: publicProcedure
    .input(z.object({ depotId: z.string(), days: z.number().int().min(1).max(14).default(7) }))
    .query(async ({ ctx, input }) => {
      const depot = await ctx.prisma.depot.findUnique({
        where: { id: input.depotId },
        select: { latitude: true, longitude: true, timezone: true },
      });
      if (!depot || depot.latitude == null || depot.longitude == null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Depot has no coordinates" });
      }
      return getForecast(depot.latitude, depot.longitude, {
        days: input.days,
        timezone: depot.timezone,
      });
    }),
});
