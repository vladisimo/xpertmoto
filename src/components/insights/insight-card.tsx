"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import type {
  InsightCard as InsightCardType,
  InsightPillar,
} from "@/server/services/insights/types";

interface Props {
  card: InsightCardType;
  basePath: string;
  children: React.ReactNode;
}

const PILLAR_LABEL: Record<InsightPillar, string> = {
  customer: "Customer",
  fleet: "Fleet",
  revenue: "Revenue",
  acquisition: "Acquisition",
};

const PRIORITY_STATUS: Record<string, StatusKey> = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

export function InsightCard({ card, basePath, children }: Props) {
  const { narrative, payload } = card;
  const priorityStatus = PRIORITY_STATUS[narrative.priority] ?? "MEDIUM";
  const detailHref = `${basePath}/${card.id}`;

  return (
    <article
      className={cn(
        "relative flex h-full flex-col gap-4 overflow-hidden rounded-lg border bg-card p-5 text-card-foreground shadow-sm transition hover:shadow-md",
      )}
      style={{ borderColor: "hsl(var(--insights-accent) / 0.25)" }}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        aria-hidden
        style={{
          background:
            "linear-gradient(to bottom, hsl(var(--insights-accent)), hsl(var(--insights-accent-soft)))",
        }}
      />
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow text-muted-foreground">
            {PILLAR_LABEL[card.pillar]}
          </span>
          <StatusBadge status={priorityStatus} />
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: "hsl(var(--insights-accent) / 0.12)",
              color: "hsl(var(--insights-accent))",
            }}
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            AI narrative
          </span>
        </div>
        <span
          className="text-caption tabular-nums"
          style={{ color: "hsl(var(--insights-accent))" }}
        >
          {Math.round(narrative.confidence * 100)}% confidence
        </span>
      </header>

      <div className="space-y-1">
        <h3 className="h3 text-foreground">{narrative.headline}</h3>
        <p className="text-body text-muted-foreground">{narrative.summary}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
        <div>
          <div className="eyebrow text-muted-foreground">
            {payload.headlineMetric.label}
          </div>
          <div className="font-display text-2xl font-semibold tabular-nums text-foreground">
            {payload.headlineMetric.value}
          </div>
          {payload.headlineMetric.trendLabel && (
            <div className="text-caption text-muted-foreground">
              {payload.headlineMetric.trendLabel}
            </div>
          )}
        </div>
        {typeof payload.headlineMetric.trendPct === "number" && (
          <TrendBadge pct={payload.headlineMetric.trendPct} />
        )}
      </div>

      <div className="flex-1">{children}</div>

      <div
        className="rounded-md p-3"
        style={{
          backgroundColor: "hsl(var(--insights-accent) / 0.08)",
          border: "1px solid hsl(var(--insights-accent) / 0.2)",
        }}
      >
        <div
          className="eyebrow"
          style={{ color: "hsl(var(--insights-accent))" }}
        >
          Recommended action
        </div>
        <p className="mt-1 text-caption text-foreground">
          {narrative.recommendation}
        </p>
      </div>

      <div className="flex justify-end">
        <Link
          href={detailHref}
          className="inline-flex items-center gap-1 text-caption font-medium hover:underline"
          style={{ color: "hsl(var(--insights-accent))" }}
        >
          View details
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

function TrendBadge({ pct }: { pct: number }) {
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const colour =
    dir === "up"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : dir === "down"
        ? "bg-destructive/15 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        colour,
      )}
    >
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}
