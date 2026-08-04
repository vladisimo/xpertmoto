import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FleetSearchGrid, type FleetSearchModel } from "@/components/fleet/fleet-search-grid";
import { FleetHero } from "@/components/fleet/fleet-hero";
import { RENTABLE_MODEL_WHERE } from "@/lib/fleet/consumer-visibility";
import {
  ALL_TAB,
  DEFAULT_FLEET_TAB,
  slugToTab,
  type FleetTab,
} from "@/lib/fleet-use-cases";
import { slugToBikeType } from "@/lib/bike-types";
import { slugToRiderLevel } from "@/lib/rider-levels";
import { slugToBand } from "@/lib/engine-bands";
import { buildMetadata } from "@/lib/seo/metadata";
import type { Metadata } from "next";

// Per-page title (composed via the root template) + canonical/OG via buildMetadata.
export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: "Our fleet",
    description:
      "Browse our full scooter & motorbike hire fleet — LAMS learner bikes, commuter scooters and touring machines, filterable by size, rider level and use.",
    path: "/fleet",
  });
}

/** Number of cards in the "high-performance picks" featured strip. */
const FEATURED_COUNT = 3;
/** Below this count the featured strip would just mirror a thin grid — skip it. */
const FEATURED_MIN_MODELS = 6;

/**
 * Pick the highest-spec bikes for the featured strip. Engine capacity is the
 * headline performance proxy in this fleet; daily rate breaks ties (premium
 * machines cost more). Models with no engine spec are excluded so the strip
 * never features a bike we can't rank.
 */
function pickFeatured(models: FleetSearchModel[]): FleetSearchModel[] {
  if (models.length < FEATURED_MIN_MODELS) return [];
  const ranked = models
    .filter((m) => m.specs?.engineCapacityCc != null)
    .sort(
      (a, b) =>
        (b.specs?.engineCapacityCc ?? 0) - (a.specs?.engineCapacityCc ?? 0) ||
        b.category.baseDailyRate - a.category.baseDailyRate,
    )
    .slice(0, FEATURED_COUNT);
  return ranked.length === FEATURED_COUNT ? ranked : [];
}

async function getModels(tab: FleetTab): Promise<FleetSearchModel[]> {
  const where: Prisma.VehicleModelWhereInput = { ...RENTABLE_MODEL_WHERE };
  if (tab !== ALL_TAB) {
    where.useCases = { has: tab };
  }

  const models = await prisma.vehicleModel.findMany({
    where,
    select: {
      id: true,
      slug: true,
      make: true,
      model: true,
      year: true,
      tagline: true,
      useCases: true,
      bikeTypes: true,
      riderLevels: true,
      engineCapacityCc: true,
      dryWeightKg: true,
      seatHeightMm: true,
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
          colour: true,
          images: {
            where: { isPrimary: true },
            orderBy: { displayOrder: "asc" },
            take: 1,
            select: { url: true },
          },
        },
      },
    },
    orderBy: [{ make: "asc" }, { model: "asc" }],
  });

  return models
    .map((m) => {
      const availableCount = m.vehicles.filter((v) => v.status === "AVAILABLE").length;
      const primaryImageUrl =
        m.vehicles.flatMap((v) => v.images).find((img) => Boolean(img?.url))?.url ?? null;
      const colours = Array.from(
        new Set(
          m.vehicles
            .map((v) => v.colour?.trim())
            .filter((c): c is string => Boolean(c)),
        ),
      );
      return {
        id: m.id,
        slug: m.slug,
        make: m.make,
        model: m.model,
        year: m.year,
        tagline: m.tagline,
        useCases: m.useCases,
        bikeTypes: m.bikeTypes,
        riderLevels: m.riderLevels,
        colours,
        specs: {
          engineCapacityCc: m.engineCapacityCc,
          dryWeightKg: m.dryWeightKg ? m.dryWeightKg.toNumber() : null,
          seatHeightMm: m.seatHeightMm,
        },
        category: {
          id: m.category?.id ?? "",
          licenceRequired: m.category?.licenceRequired ?? "",
          baseDailyRate: m.category ? m.category.baseDailyRate.toNumber() : 0,
        },
        availableCount,
        primaryImageUrl,
      };
    })
    .sort((a, b) => {
      if (b.availableCount !== a.availableCount) return b.availableCount - a.availableCount;
      if (a.make !== b.make) return a.make.localeCompare(b.make);
      return a.model.localeCompare(b.model);
    });
}

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{
    use?: string;
    type?: string;
    level?: string;
    cc?: string;
  }>;
}) {
  const resolvedSearch = await searchParams;
  const tab = slugToTab(resolvedSearch?.use) ?? DEFAULT_FLEET_TAB;
  const models = await getModels(tab);

  // Bike type / rider level / engine band are refined client-side, but we seed
  // them from the URL so deep links like /fleet?type=sport&cc=601-1000 land
  // pre-filtered with the dropdowns reflecting that state.
  const initialFilters = {
    bikeType: slugToBikeType(resolvedSearch?.type),
    riderLevel: slugToRiderLevel(resolvedSearch?.level),
    band: slugToBand(resolvedSearch?.cc),
  };

  const featured = pickFeatured(models);

  return (
    <>
      {/* Pulled up behind the transparent navbar — see TRANSPARENT_BG_ROUTES. */}
      <div className="-mt-20">
        <FleetHero featured={featured} />
      </div>

      <div className="container space-y-10 py-12">
        {models.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-muted/40 p-10 text-center">
            <p className="text-lg font-medium">No bikes available right now.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              We&rsquo;re adding more bikes to our fleet all the time — check back soon.
            </p>
          </div>
        ) : (
          <FleetSearchGrid
            key={tab}
            models={models}
            activeTab={tab}
            initialFilters={initialFilters}
          />
        )}
      </div>
    </>
  );
}
