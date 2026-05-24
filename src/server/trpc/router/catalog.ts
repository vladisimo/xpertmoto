import { createTRPCRouter, publicProcedure } from "../trpc";
import { cached } from "@/lib/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { CATEGORY_HAS_RENTABLE_VEHICLE } from "@/lib/fleet/consumer-visibility";

export const catalogRouter = createTRPCRouter({
  addons: publicProcedure.query(({ ctx }) =>
    cached(
      "catalog:addons:active",
      3600,
      () => ctx.prisma.addon.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      [CACHE_TAGS.CATEGORIES],
    ),
  ),
  insurance: publicProcedure.query(({ ctx }) =>
    cached(
      "catalog:insurance:active",
      3600,
      () =>
        ctx.prisma.insuranceOption.findMany({
          where: { isActive: true },
          orderBy: { dailyRate: "asc" },
        }),
      [CACHE_TAGS.CATEGORIES],
    ),
  ),
  listCategories: publicProcedure.query(({ ctx }) =>
    cached(
      "catalog:categories:active",
      3600,
      () =>
        ctx.prisma.vehicleCategory.findMany({
          where: { isActive: true, ...CATEGORY_HAS_RENTABLE_VEHICLE },
          orderBy: { displayOrder: "asc" },
          select: { id: true, name: true, slug: true },
        }),
      [CACHE_TAGS.CATEGORIES],
    ),
  ),
});
