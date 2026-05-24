"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SpecTable, type SpecRow } from "@/components/marketing/spec-table";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics/track";

export interface FleetCardProps {
  name: string;
  /** Small caption above the title (e.g. "XPERT Moto fleet"). */
  vendor?: string;
  description?: string | null;
  imageSrc?: string | null;
  /** "L" / "R" / "RE" licence class — renders as a small yellow badge top-left. */
  licenceBadge?: string | null;
  specs: SpecRow[];
  dailyRate: number;
  /** Count of available vehicles in this category; rendered as "N available". */
  availableCount?: number | null;
  bookHref: string;
  className?: string;
  /**
   * Stable id used as the `target` on FLEET_VIEW / FLEET_CLICK events.
   * Typically the category slug or vehicle id so downstream aggregates
   * can reason about which vehicles draw attention vs bookings.
   */
  trackingId?: string;
}

/**
 * Fleet / category card — XPERT-style product card.
 * Image on a neutral surface top, licence badge top-left, vendor caption,
 * category name, spec table, price row, primary CTA.
 */
export function FleetCard({
  name,
  vendor,
  description,
  imageSrc,
  licenceBadge,
  specs,
  dailyRate,
  availableCount,
  bookHref,
  className,
  trackingId,
}: FleetCardProps) {
  const ref = React.useRef<HTMLElement | null>(null);
  const viewedRef = React.useRef(false);
  React.useEffect(() => {
    if (!trackingId || viewedRef.current) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !viewedRef.current) {
            viewedRef.current = true;
            trackEvent({
              kind: "FLEET_VIEW",
              target: trackingId,
              value: name,
            });
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [trackingId, name]);

  return (
    <article
      ref={ref}
      className={cn("group flex flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground transition-shadow hover:shadow-md", className)}
    >
      <div className="relative aspect-[4/3] bg-muted">
        {imageSrc ? (
          <Image src={imageSrc} alt={name} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="caption">Photo coming soon</span>
          </div>
        )}
        {licenceBadge && (
          <span className="absolute left-3 top-3 inline-flex h-7 min-w-7 items-center justify-center rounded-sm bg-secondary px-1.5 text-sm font-semibold text-secondary-foreground">
            {licenceBadge}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          {vendor && <div className="caption uppercase tracking-[0.08em]">{vendor}</div>}
          <h3 className="h3 mt-0.5">{name}</h3>
        </div>
        <SpecTable rows={specs} />
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <div className="mt-auto flex items-baseline justify-between">
          <div>
            <div className="text-2xl font-semibold tabular-nums text-foreground">
              {formatCurrency(dailyRate)}
            </div>
            <div className="caption">per day</div>
          </div>
          {typeof availableCount === "number" && (
            <div className="caption">{availableCount} available</div>
          )}
        </div>
        <Button asChild variant="cta" className="w-full">
          <Link
            href={bookHref}
            data-track={trackingId ?? "fleet-card-book"}
            data-track-kind="FLEET_CLICK"
            data-track-value={name}
          >
            Book now ➔
          </Link>
        </Button>
      </div>
    </article>
  );
}
