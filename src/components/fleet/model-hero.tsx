import { FleetUseCase } from "@prisma/client";
import { formatCurrency } from "@/lib/utils";
import { ModelGallery, type ModelGalleryImage } from "@/components/fleet/model-gallery";
import {
  RentalEstimate,
  type RentalEstimateTier,
} from "@/components/fleet/rental-estimate";
import { ModelBookingPanel } from "@/components/fleet/model-booking-panel";
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
  inventoryCount: number;
  categoryId: string;
  modelId: string;
  sampleVehicleId: string | null;
  firstAvailableVehicleId: string | null;
  depotsWithStock: Array<{ id: string; name: string; state: string; availableCount: number }>;
  modelDepots: Array<{ id: string; name: string; state: string }>;
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
  inventoryCount,
  categoryId,
  modelId,
  sampleVehicleId,
  modelDepots,
  pricingTiers,
}: ModelHeroProps) {
  const offTheRoad = availableCount === 0 && inventoryCount > 0;
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

        {offTheRoad ? (
          <p className="rounded-md border border-amber-600/30 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
            Currently off the road for servicing. Pick your dates below to check for
            future availability, or contact us.
          </p>
        ) : null}

        <ModelBookingPanel
          categoryId={categoryId}
          modelId={modelId}
          modelLabel={`${make} ${model}`}
          bondAmount={bondAmount}
          sampleVehicleId={sampleVehicleId}
          modelDepots={modelDepots}
        />
      </div>
    </div>
  );
}
