"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileListRowProps {
  /** Primary line — the row's main label (booking ref, customer name, …). */
  primary: React.ReactNode;
  /** Secondary line below primary (date range, email, …). */
  secondary?: React.ReactNode;
  /** Right-aligned status pill (use `<StatusBadge>` — never raw colour pairs). */
  status?: React.ReactNode;
  /** Optional dense meta line below secondary (price, count, …). */
  meta?: React.ReactNode;
  /** Leading slot — avatar, icon, or thumbnail. */
  leading?: React.ReactNode;
  /** When set, the row is a `<Link>` to this href. */
  href?: string;
  /** When set (and no href), the row is a `<button>` that fires this. */
  onSelect?: () => void;
  /** Hide the trailing chevron when the row isn't navigable or already
   *  has its own trailing affordance. */
  hideChevron?: boolean;
  className?: string;
}

/**
 * The standard mobile tap target. Renders inside a card surface; height
 * meets the 44px minimum tap target. Use for any list of records on
 * mobile — agenda lines, ticket queue, customer list, etc.
 *
 * For a `DataTable` consumer prefer `mobileMode="cards"` on the table
 * itself (the table builds the equivalent layout from column metadata).
 */
export function MobileListRow({
  primary,
  secondary,
  status,
  meta,
  leading,
  href,
  onSelect,
  hideChevron,
  className,
}: MobileListRowProps) {
  const interactive = Boolean(href || onSelect);
  const showChevron = interactive && !hideChevron;

  const body = (
    <div className="flex items-center gap-3 p-3">
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-body font-medium text-foreground">{primary}</span>
          {status ? <span className="shrink-0">{status}</span> : null}
        </div>
        {secondary ? (
          <div className="truncate text-caption text-muted-foreground">{secondary}</div>
        ) : null}
        {meta ? (
          <div className="truncate text-caption text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {showChevron ? (
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
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cn(base, hover, "cursor-pointer", className)}
      >
        {body}
      </div>
    );
  }
  return <div className={cn(base, className)}>{body}</div>;
}
