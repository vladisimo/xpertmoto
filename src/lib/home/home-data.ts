import { cacheLife, cacheTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RENTABLE_MODEL_WHERE } from "@/lib/fleet/consumer-visibility";
import type { HomeFleetPreviewModel } from "@/components/fleet/home-fleet-preview";

/**
 * Homepage data reads, cached so the marketing landing page can be statically
 * prerendered (PPR) instead of hitting the DB on every request. Keeping these
 * out of the per-request render is what lets the hero `<h1>`, section headings
 * and nav land in the static HTML a no-JS SEO crawler reads — and drops TTFB.
 *
 * Mirrors the `"use cache"` pattern in `src/lib/branding.ts`: cacheLife/cacheTag
 * throw outside a Next cache runtime (Vitest), so they're guarded — the
 * directive itself is a harmless no-op there and the function falls back to a
 * plain read. Availability shown here is a marketing preview (the booking wizard
 * is the source of truth), so a short `minutes` TTL is acceptable.
 */

const homeDepotArgs = {
  where: { isActive: true, deletedAt: null },
  orderBy: { name: "asc" },
  include: {
    _count: { select: { vehicles: { where: { status: "AVAILABLE" } } } },
    operatingHours: {
      where: { holidayDate: null },
      orderBy: { dayOfWeek: "asc" },
    },
  },
} satisfies Prisma.DepotFindManyArgs;

export type HomeDepot = Prisma.DepotGetPayload<typeof homeDepotArgs>;

export async function getHomeDepots(): Promise<HomeDepot[]> {
  "use cache";
  try {
    cacheLife("minutes");
    cacheTag("depots");
  } catch {
    // not in a Next cache runtime — fall through to a plain read
  }
  return prisma.depot.findMany(homeDepotArgs);
}

export async function getFleetPreview(): Promise<HomeFleetPreviewModel[]> {
  "use cache";
  try {
    cacheLife("minutes");
    cacheTag("fleet-preview");
  } catch {
    // not in a Next cache runtime — fall through to a plain read
  }
  const models = await prisma.vehicleModel.findMany({
    where: {
      ...RENTABLE_MODEL_WHERE,
      useCases: { isEmpty: false },
    },
    select: {
      id: true,
      slug: true,
      make: true,
      model: true,
      year: true,
      tagline: true,
      useCases: true,
      riderLevels: true,
      category: {
        select: {
          id: true,
          licenceRequired: true,
          baseDailyRate: true,
        },
      },
      vehicles: {
        where: { isActive: true },
        select: {
          status: true,
          images: {
            where: { isPrimary: true },
            orderBy: { displayOrder: "asc" },
            take: 1,
            select: { url: true },
          },
        },
      },
    },
  });

  return models
    .map((m) => {
      const availableCount = m.vehicles.filter((v) => v.status === "AVAILABLE").length;
      const primaryImageUrl =
        m.vehicles.flatMap((v) => v.images).find((img) => Boolean(img?.url))?.url ?? null;
      return {
        id: m.id,
        slug: m.slug,
        make: m.make,
        model: m.model,
        year: m.year,
        tagline: m.tagline,
        useCases: m.useCases,
        riderLevels: m.riderLevels,
        category: {
          id: m.category?.id ?? "",
          licenceRequired: m.category?.licenceRequired ?? "",
          baseDailyRate: m.category ? m.category.baseDailyRate.toNumber() : 0,
        },
        availableCount,
        primaryImageUrl,
      };
    })
    .filter((m) => m.primaryImageUrl !== null);
}
