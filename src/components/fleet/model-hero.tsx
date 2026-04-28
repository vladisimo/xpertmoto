import Link from "next/link";
import { FleetUseCase } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { ModelGallery, type ModelGalleryImage } from "@/components/fleet/model-gallery";
import {
  RentalEstimate,
  type RentalEstimateTier,
} from "@/components/fleet/rental-estimate";
import { USE_CASE_LABELS } from "@/lib/fleet-use-cases";

export interface ModelHeroProps {
  make: string;
  model: string;
  year: number;
  tagline?: string | null;
  licenceRequired?: string | null;
  useCases: FleetUseCase[];
  images: ModelGalleryImage[];
  dailyRate: number;
  weeklyRate: number;
  monthlyRate: number;
  bondAmount: number;
  availableCount: number;
  categoryId: string;
  firstAvailableVehicleId: string | null;
  depotsWithStock: Array<{ id: string; name: string; state: string; availableCount: number }>;
  pricingTiers?: RentalEstimateTier[];
}

export function ModelHero({
  make,
  model,
  year,
  tagline,
  licenceRequired,
  useCases,
  images,
  dailyRate,
  weeklyRate,
  monthlyRate,
  bondAmount,
  availableCount,
  categoryId,
  firstAvailableVehicleId,
  depotsWithStock,
  pricingTiers,
}: ModelHeroProps) {
  const bookParams = new URLSearchParams({ categoryId });
  if (firstAvailableVehicleId) bookParams.set("vehicleId", firstAvailableVehicleId);
  const bookHref = `/booking?${bookParams.toString()}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
      <ModelGallery images={images} alt={`${year} ${make} ${model}`} />

      <div className="flex flex-col gap-6">
        <div>
          <div className="caption uppercase tracking-[0.14em]">
            {year} {make}
          </div>
          <h1 className="h-display mt-1 text-4xl md:text-5xl">{model}</h1>
          {tagline && (
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">{tagline}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {licenceRequired && (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
              {licenceRequired} licence
            </span>
          )}
          {useCases.map((uc) => (
            <span
              key={uc}
              className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
            >
              {USE_CASE_LABELS[uc]}
            </span>
          ))}
        </div>

        <div className="space-y-4 border-y border-border py-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="caption uppercase tracking-[0.08em]">From</div>
              <div className="text-4xl font-semibold tabular-nums text-foreground">
                {formatCurrency(dailyRate)}
              </div>
              <div className="caption">per day</div>
            </div>
            <div className="text-right text-sm">
              <span className="text-muted-foreground">Bond: </span>
              <span className="font-medium">{formatCurrency(bondAmount)}</span>
            </div>
          </div>
          <RentalEstimate
            dailyRate={dailyRate}
            weeklyRate={weeklyRate}
            monthlyRate={monthlyRate}
            tiers={pricingTiers}
          />
        </div>

        <div className="flex flex-col gap-2">
          {availableCount > 0 ? (
            <Button asChild variant="cta" size="lg" className="w-full sm:w-auto">
              <Link href={bookHref}>Book this bike ➔</Link>
            </Button>
          ) : (
            <Button variant="cta" size="lg" className="w-full sm:w-auto" disabled aria-disabled>
              Currently fully booked
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            {availableCount > 0
              ? `${availableCount} available now${
                  depotsWithStock.length > 0
                    ? ` at ${depotsWithStock
                        .map((d) => `${d.name} (${d.availableCount})`)
                        .join(", ")}`
                    : ""
                }.`
              : "All units currently on hire — check back soon or contact us for availability."}
          </p>
        </div>
      </div>
    </div>
  );
}
