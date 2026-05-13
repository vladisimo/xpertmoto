"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileStatCardProps {
  /** Short label (e.g. "Today's revenue"). */
  label: React.ReactNode;
  /** The big number / value. */
  value: React.ReactNode;
  /** Optional supporting line (delta, period, sub-totals). */
  caption?: React.ReactNode;
  /** Leading slot — icon, glyph, etc. */
  leading?: React.ReactNode;
  /** Right-aligned trend slot (sparkline, delta pill). */
  trend?: React.ReactNode;
  /** Make the card a `<Link>` to drill down. */
  href?: string;
  /** Make the card a `<button>` triggering this. Ignored if href is set. */
  onSelect?: () => void;
  className?: string;
}

/**
 * Single big-number tile sized for vertical stacking on mobile.
 * Replaces the 2- or 4-col KPI grids on dashboards. Each tile is a tap
 * target that drills into the underlying detail.
 *
 * On desktop, prefer the existing `StatShell` / dashboard widget pattern.
 * Use this only inside a mobile branch.
 */
export function MobileStatCard({
  label,
  value,
  caption,
  leading,
  trend,
  href,
  onSelect,
  className,
}: MobileStatCardProps) {
  const interactive = Boolean(href || onSelect);

  const body = (
    <div className="flex items-center gap-3 p-4">
      {leading ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {leading}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-caption uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-2xl font-semibold leading-tight text-foreground">
          {value}
        </div>
        {caption ? (
          <div className="text-caption text-muted-foreground">{caption}</div>
        ) : null}
      </div>
      {trend ? <div className="shrink-0">{trend}</div> : null}
      {interactive && !trend ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </div>
  );

  const base =
    "block w-full rounded-md border bg-card text-left text-card-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const hover = interactive ? "transition-colors hover:bg-muted/40" : undefined;

  if (href) {
    return (
      <Link href={href} className={cn(base, hover, className)}>
        {body}
      </Link>
    );
  }
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={cn(base, hover, className)}>
        {body}
      </button>
    );
  }
  return <div className={cn(base, className)}>{body}</div>;
}
