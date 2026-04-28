import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FleetSearchGrid, type FleetSearchModel } from "@/components/fleet/fleet-search-grid";
import { UseCaseTabs } from "@/components/fleet/use-case-tabs";
import {
  ALL_TAB,
  DEFAULT_FLEET_TAB,
  slugToTab,
  type FleetTab,
} from "@/lib/fleet-use-cases";

async function getModels(tab: FleetTab): Promise<FleetSearchModel[]> {
  const where: Prisma.VehicleModelWhereInput = {
    vehicles: { some: { isActive: true } },
  };
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
        colours,
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
  searchParams: Promise<{ use?: string }>;
}) {
  const resolvedSearch = await searchParams;
  const tab = slugToTab(resolvedSearch?.use) ?? DEFAULT_FLEET_TAB;
  const models = await getModels(tab);

  return (
    <div className="container space-y-10 py-12">
      <div className="space-y-2">
        <p className="caption uppercase tracking-[0.14em]">Our fleet</p>
        <h1 className="h-display">Pick your ride</h1>
        <p className="max-w-2xl text-muted-foreground">
          From lightweight learner scooters to unrestricted adventure tourers. Filter by how
          you plan to ride — every bike is meticulously maintained and ready to roll.
        </p>
      </div>

      <UseCaseTabs active={tab} includeAll />

      {models.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-md border border-dashed border-border bg-muted/40 p-10 text-center">
          <p className="text-lg font-medium">No bikes available right now.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            We&rsquo;re adding more bikes to our fleet all the time — check back soon.
          </p>
        </div>
      ) : (
        <FleetSearchGrid key={tab} models={models} />
      )}
    </div>
  );
}
