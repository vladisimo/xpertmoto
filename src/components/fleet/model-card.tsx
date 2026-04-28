import Image from "next/image";
import Link from "next/link";
import { FleetUseCase } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { formatCurrency, cn } from "@/lib/utils";

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
  bookHref: string;
  className?: string;
}

export function ModelCard({
  slug,
  make,
  model,
  year,
  imageSrc,
  licenceBadge,
  lamsApproved,
  dailyRate,
  bookHref,
  className,
}: ModelCardProps) {
  const detailHref = `/fleet/${slug}`;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-md border border-border bg-card text-card-foreground transition-shadow hover:shadow-md",
        className,
      )}
    >
      <Link
        href={detailHref}
        aria-label={`View details for ${year} ${make} ${model}`}
        className="relative block aspect-[4/3] bg-muted"
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={`${make} ${model}`}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="caption">Photo coming soon</span>
          </div>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 via-black/30 to-transparent"
        />
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
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
        <div className="absolute right-3 top-3 flex flex-col items-end rounded-md bg-background/90 px-2.5 py-1.5 text-right shadow-sm backdrop-blur">
          <span className="text-base font-semibold tabular-nums leading-none text-foreground">
            {formatCurrency(dailyRate)}
          </span>
          <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            per day
          </span>
        </div>
        <div className="absolute bottom-3 left-3 max-w-[55%] text-white">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-white/80">
            {year} {make}
          </div>
          <div className="h3 text-white">{model}</div>
        </div>
      </Link>
      <Button
        asChild
        variant="cta"
        size="sm"
        className="absolute bottom-3 right-3 z-10"
      >
        <Link href={bookHref}>Book now ➔</Link>
      </Button>
    </article>
  );
}
