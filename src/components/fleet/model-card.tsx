import Image from "next/image";
import Link from "next/link";
import { Gauge, Ruler, Weight } from "lucide-react";
import { FleetUseCase } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, cn } from "@/lib/utils";

export interface ModelCardSpecs {
  engineCapacityCc?: number | null;
  dryWeightKg?: number | null;
  seatHeightMm?: number | null;
}

export interface ModelCardProps {
  slug: string;
  make: string;
  model: string;
  year: number;
  tagline?: string | null;
  imageSrc?: string | null;
  licenceBadge?: string | null;
  lamsApproved?: boolean;
  useCases?: FleetUseCase[];
  dailyRate: number;
  availableCount: number;
  /** Key specs surfaced as an at-a-glance row. Omitted on the home preview. */
  specs?: ModelCardSpecs | null;
  /**
   * "stacked" (default) puts the details in a footer below the image.
   * "overlay" lays them over the image for a denser, shorter card — used by
   * the featured strip.
   */
  layout?: "stacked" | "overlay";
  bookHref: string;
  className?: string;
}

/**
 * The availability pill: scarcity drives conversion, abundance reassures.
 * When nothing is available we show no pill at all (rather than a dead-end
 * "sold out" message) so a fully-booked-but-rentable model still reads clean.
 */
function AvailabilityPill({ count }: { count: number }) {
  if (count <= 0) return null;
  if (count <= 2) {
    return <StatusBadge status="STOCK_LOW" label={`Only ${count} left`} />;
  }
  return <StatusBadge status="AVAILABLE" label={`${count} available`} />;
}

function SpecGlance({ specs, className }: { specs: ModelCardSpecs; className?: string }) {
  const items: Array<{ icon: typeof Gauge; value: string }> = [];
  if (specs.engineCapacityCc != null) {
    items.push({ icon: Gauge, value: `${specs.engineCapacityCc}cc` });
  }
  if (specs.dryWeightKg != null) {
    items.push({ icon: Weight, value: `${Math.round(specs.dryWeightKg)}kg` });
  }
  if (specs.seatHeightMm != null) {
    items.push({ icon: Ruler, value: `${specs.seatHeightMm}mm` });
  }
  if (items.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs", className)}>
      {items.map(({ icon: Icon, value }) => (
        <li key={value} className="inline-flex items-center gap-1.5">
          <Icon aria-hidden className="h-3.5 w-3.5" />
          <span className="tabular-nums">{value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Top-left licence + LAMS badges, shared by both layouts. */
function CornerBadges({
  licenceBadge,
  lamsApproved,
}: {
  licenceBadge?: string | null;
  lamsApproved?: boolean;
}) {
  return (
    <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5">
      {licenceBadge && (
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-sm bg-secondary px-1.5 text-sm font-semibold text-secondary-foreground">
          {licenceBadge}
        </span>
      )}
      {lamsApproved && (
        <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground">
          LAMS
        </span>
      )}
    </div>
  );
}

/** Top-right price box, shared by both layouts. */
function PriceBox({ dailyRate }: { dailyRate: number }) {
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col items-end rounded-md bg-background/90 px-2.5 py-1.5 text-right shadow-sm backdrop-blur">
      <span className="text-base font-semibold tabular-nums leading-none text-foreground">
        {formatCurrency(dailyRate)}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        per day
      </span>
    </div>
  );
}

function NoImage() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="caption">Photo coming soon</span>
    </div>
  );
}

export function ModelCard({
  slug,
  make,
  model,
  year,
  tagline,
  imageSrc,
  licenceBadge,
  lamsApproved,
  dailyRate,
  availableCount,
  specs,
  layout = "stacked",
  bookHref,
  className,
}: ModelCardProps) {
  const detailHref = `/fleet/${slug}`;
  const ariaLabel = `View details for ${year} ${make} ${model}`;

  if (layout === "overlay") {
    return (
      <article
        className={cn(
          "group relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted text-white transition-shadow hover:shadow-md",
          className,
        )}
      >
        <Link href={detailHref} aria-label={ariaLabel} className="absolute inset-0 z-0">
          {imageSrc ? (
            <Image
              src={imageSrc}
              alt={`${make} ${model}`}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-contain transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <NoImage />
          )}
        </Link>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-black/85 via-black/45 to-black/5"
        />

        <CornerBadges licenceBadge={licenceBadge} lamsApproved={lamsApproved} />
        <PriceBox dailyRate={dailyRate} />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-start gap-2 p-4">
          <AvailabilityPill count={availableCount} />
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-white/80">
              {year} {make}
            </p>
            <h3 className="h3 text-white">{model}</h3>
            {tagline && (
              <p className="line-clamp-1 text-sm text-white/80">{tagline}</p>
            )}
          </div>
          {specs && <SpecGlance specs={specs} className="text-white/80" />}
          <Button
            asChild
            variant="cta"
            size="sm"
            className="pointer-events-auto mt-1 w-full"
          >
            <Link href={bookHref}>Book now ➔</Link>
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground transition-shadow hover:shadow-md",
        className,
      )}
    >
      <Link href={detailHref} aria-label={ariaLabel} className="relative block aspect-[4/3] bg-muted">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={`${make} ${model}`}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-contain transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <NoImage />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 via-black/15 to-transparent"
        />
        <CornerBadges licenceBadge={licenceBadge} lamsApproved={lamsApproved} />
        <PriceBox dailyRate={dailyRate} />
        <div className="absolute bottom-3 left-3 z-10">
          <AvailabilityPill count={availableCount} />
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {year} {make}
          </p>
          <h3 className="h3">
            <Link href={detailHref} className="hover:underline">
              {model}
            </Link>
          </h3>
          {tagline && (
            <p className="line-clamp-1 text-sm text-muted-foreground">{tagline}</p>
          )}
        </div>

        {specs && <SpecGlance specs={specs} className="text-muted-foreground" />}

        <div className="mt-auto pt-1">
          <Button asChild variant="cta" size="sm" className="w-full">
            <Link href={bookHref}>Book now ➔</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
