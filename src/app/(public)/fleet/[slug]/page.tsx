import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { FleetUseCase } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ModelHero } from "@/components/fleet/model-hero";
import { dedupeModelImages } from "@/components/fleet/model-images";
import { ModelSpecs, type ModelSpecsInput } from "@/components/fleet/model-specs";
import { RelatedModels, type RelatedModelEntry } from "@/components/fleet/related-models";
import { Button } from "@/components/ui/button";
import { DividedTitle } from "@/components/marketing/divided-title";
import { buildMetadata } from "@/lib/seo/metadata";
import { absoluteUrl } from "@/lib/seo/site-url";
import { productLd, breadcrumbLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/seo/json-ld";

async function getModel(slug: string) {
  const model = await prisma.vehicleModel.findUnique({
    where: { slug },
    include: {
      category: true,
      vehicles: {
        where: { isActive: true },
        orderBy: [{ status: "asc" }, { currentOdometerKm: "asc" }],
        select: {
          id: true,
          status: true,
          depot: { select: { id: true, name: true, slug: true, state: true } },
          images: {
            orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
            select: { id: true, url: true, caption: true, checksum: true, isPrimary: true },
          },
        },
      },
    },
  });

  // Internal/service vehicles (isRentable=false) must 404 for consumers.
  if (!model || !model.isRentable || !model.vehicles.length || !model.category) return null;

  // Category-level tier ladder (if configured) powers the RentalEstimate
  // preview. Per-vehicle overrides aren't surfaced on the model page since
  // the user hasn't picked a specific vehicle yet.
  const pricingTiers = await prisma.pricingTier.findMany({
    where: { categoryId: model.category.id, isActive: true },
    orderBy: { minDays: "asc" },
    select: { minDays: true, maxDays: true, tierTotal: true },
  });

  const images = dedupeModelImages(model.vehicles);

  const available = model.vehicles.filter((v) => v.status === "AVAILABLE");
  const depotMap = new Map<
    string,
    { id: string; name: string; slug: string; state: string; availableCount: number }
  >();
  for (const v of available) {
    if (!v.depot) continue;
    const existing = depotMap.get(v.depot.id);
    if (existing) existing.availableCount += 1;
    else depotMap.set(v.depot.id, { ...v.depot, availableCount: 1 });
  }

  // Depots where this model has ANY active unit (not only AVAILABLE ones) — a
  // unit on hire today may still be free for a future date range, so the
  // date-aware booking panel must be able to offer every depot the model
  // physically lives at, not just the ones with stock right now.
  const allDepotMap = new Map<string, { id: string; name: string; state: string }>();
  for (const v of model.vehicles) {
    if (!v.depot || allDepotMap.has(v.depot.id)) continue;
    allDepotMap.set(v.depot.id, { id: v.depot.id, name: v.depot.name, state: v.depot.state });
  }

  return {
    id: model.id,
    slug: model.slug,
    make: model.make,
    model: model.model,
    year: model.year,
    tagline: model.tagline,
    useCases: model.useCases,
    specs: {
      engineCapacityCc: model.engineCapacityCc,
      enginePowerKw: model.enginePowerKw?.toString() ?? null,
      engineTorqueNm: model.engineTorqueNm?.toString() ?? null,
      dryWeightKg: model.dryWeightKg?.toString() ?? null,
      fuelTankLitres: model.fuelTankLitres?.toString() ?? null,
      fuelType: model.fuelType,
      topSpeedKmh: model.topSpeedKmh,
      seatHeightMm: model.seatHeightMm,
      tyreFront: model.tyreFront,
      tyreRear: model.tyreRear,
      serviceIntervalKm: model.serviceIntervalKm,
      serviceIntervalMonths: model.serviceIntervalMonths,
    } satisfies ModelSpecsInput,
    category: {
      id: model.category.id,
      name: model.category.name,
      licenceRequired: model.category.licenceRequired,
      baseDailyRate: model.category.baseDailyRate.toNumber(),
      baseWeeklyRate: model.category.baseWeeklyRate.toNumber(),
      baseMonthlyRate: model.category.baseMonthlyRate.toNumber(),
      bondAmount: model.category.bondAmount.toNumber(),
    },
    images,
    availableCount: available.length,
    inventoryCount: model.vehicles.length,
    firstAvailableVehicleId: available[0]?.id ?? null,
    // First active unit, used by the booking panel as a pricing-fallback
    // vehicleId so a quote can still render when nothing is free for the
    // chosen dates (price preview), and so per-model rate overrides apply.
    sampleVehicleId: model.vehicles[0]?.id ?? null,
    depotsWithStock: Array.from(depotMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    modelDepots: Array.from(allDepotMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    pricingTiers: pricingTiers.map((t) => ({
      minDays: t.minDays,
      maxDays: t.maxDays,
      tierTotal: t.tierTotal.toNumber(),
    })),
  };
}

async function getRelated(
  useCases: FleetUseCase[],
  excludeSlug: string,
): Promise<RelatedModelEntry[]> {
  if (useCases.length === 0) return [];
  const preferred = useCases[0]!;
  const models = await prisma.vehicleModel.findMany({
    where: {
      useCases: { has: preferred },
      slug: { not: excludeSlug },
      vehicles: { some: { isActive: true } },
    },
    take: 6,
    select: {
      slug: true,
      make: true,
      model: true,
      year: true,
      category: { select: { baseDailyRate: true } },
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
    .map((m) => ({
      slug: m.slug,
      make: m.make,
      model: m.model,
      year: m.year,
      primaryImageUrl:
        m.vehicles.flatMap((v) => v.images).find((img) => Boolean(img?.url))?.url ?? null,
      dailyRate: m.category ? m.category.baseDailyRate.toNumber() : 0,
      availableCount: m.vehicles.filter((v) => v.status === "AVAILABLE").length,
    }))
    .slice(0, 3);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const model = await prisma.vehicleModel.findUnique({
    where: { slug },
    select: { make: true, model: true, year: true, tagline: true, isRentable: true },
  });
  // Non-rentable service vehicles must not leak a title/description either.
  if (!model || !model.isRentable) {
    return buildMetadata({
      title: "Fleet",
      description: "Browse the scooter & motorbike hire fleet.",
      path: "/fleet",
      noindex: true,
    });
  }
  return buildMetadata({
    title: `${model.year} ${model.make} ${model.model} rental`,
    description:
      model.tagline ??
      `Hire the ${model.year} ${model.make} ${model.model}. Fully maintained, ready to ride.`,
    path: `/fleet/${slug}`,
  });
}

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const model = await getModel(slug);
  if (!model) notFound();

  const related = await getRelated(model.useCases, model.slug);
  const inclusions = [
    "Helmet and lock included",
    "Roadside assistance",
    "Fully maintained by our in-house mechanics",
    "Pick-up and drop-off at any depot",
  ];

  const fleetUrl = absoluteUrl(`/fleet/${model.slug}`);
  const jsonLd = [
    productLd({
      name: `${model.year} ${model.make} ${model.model}`,
      description:
        model.tagline ??
        `Hire the ${model.year} ${model.make} ${model.model} — fully maintained and ready to ride.`,
      url: fleetUrl,
      images: model.images.map((img) => img.url).slice(0, 6),
      brand: model.make,
      dailyRate: model.category.baseDailyRate,
      inStock: model.availableCount > 0,
    }),
    breadcrumbLd([
      { name: "Our fleet", url: absoluteUrl("/fleet") },
      { name: `${model.year} ${model.make} ${model.model}`, url: fleetUrl },
    ]),
  ];

  return (
    <div className="container space-y-12 py-12">
      <JsonLd data={jsonLd} />
      <nav aria-label="Breadcrumb" className="caption uppercase tracking-[0.08em]">
        <Link href="/fleet" className="hover:text-foreground">
          Our fleet
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">
          {model.year} {model.make} {model.model}
        </span>
      </nav>

      <ModelHero
        make={model.make}
        model={model.model}
        year={model.year}
        tagline={model.tagline}
        licenceRequired={model.category.licenceRequired || null}
        useCases={model.useCases}
        images={model.images}
        dailyRate={model.category.baseDailyRate}
        weeklyRate={model.category.baseWeeklyRate}
        monthlyRate={model.category.baseMonthlyRate}
        bondAmount={model.category.bondAmount}
        availableCount={model.availableCount}
        inventoryCount={model.inventoryCount}
        categoryId={model.category.id}
        modelId={model.id}
        sampleVehicleId={model.sampleVehicleId}
        firstAvailableVehicleId={model.firstAvailableVehicleId}
        depotsWithStock={model.depotsWithStock}
        modelDepots={model.modelDepots}
        pricingTiers={model.pricingTiers}
      />

      <div className="grid gap-10 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-4">
          <h2 className="h2">Specifications</h2>
          <div className="rounded-md border border-border bg-card p-6">
            <ModelSpecs input={model.specs} />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="h2">What&rsquo;s included</h2>
          <ul className="space-y-2 rounded-md border border-border bg-card p-6 text-sm">
            {inclusions.map((item) => (
              <li key={item} className="flex gap-2 text-foreground">
                <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {related.length > 0 && (
        <>
          <DividedTitle>You might also like</DividedTitle>
          <RelatedModels models={related} heading="" />
        </>
      )}

      <div className="rounded-md border border-border bg-primary/5 p-8 text-center">
        <h2 className="h2">Ready to ride?</h2>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
          Book the {model.make} {model.model} now and pick up from your nearest depot.
        </p>
        <Button asChild variant="cta" size="lg" className="mt-5">
          <Link
            href={`/booking?categoryId=${model.category.id}${
              model.firstAvailableVehicleId ? `&vehicleId=${model.firstAvailableVehicleId}` : ""
            }`}
          >
            Start your booking ➔
          </Link>
        </Button>
      </div>
    </div>
  );
}
