"use client";

import * as React from "react";
import { Users } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { CohortHeatmap } from "./charts/cohort-heatmap";
import { LeaderboardBars } from "./charts/leaderboard-bars";
import { ScatterInsight } from "./charts/scatter-insight";
import { TrendOverlay } from "./charts/trend-overlay";
import { StackedConversion } from "./charts/stacked-conversion";
import type { InsightCard } from "@/server/services/insights/types";

/**
 * Compact in-card preview. Each payload variant picks its own visual.
 * Full drill-down lives at /ai-insights/[id] via `insight-detail-client`.
 */
export function renderInsightPreview(card: InsightCard): React.ReactNode {
  switch (card.payload.id) {
    case "repeat-cohort":
      return <CohortHeatmap payload={card.payload} compact />;
    case "top-customers-at-risk":
      return <AtRiskMiniList payload={card.payload} />;
    case "revenue-per-vehicle-day":
      return (
        <LeaderboardBars
          data={card.payload.top.slice(0, 5)}
          average={card.payload.fleetAverage}
          averageLabel="Fleet avg"
          variant="top"
          height={180}
          formatValue={(n) => `$${Math.round(n).toLocaleString("en-AU")}/d`}
        />
      );
    case "maintenance-vs-revenue":
      return <ScatterInsight payload={card.payload} height={200} />;
    case "revenue-trend":
      return <TrendOverlay payload={card.payload} height={200} />;
    case "acquisition-conversion":
      return <StackedConversion payload={card.payload} height={200} />;
  }
}

function AtRiskMiniList({
  payload,
}: {
  payload: Extract<InsightCard["payload"], { id: "top-customers-at-risk" }>;
}) {
  const atRisk = payload.rows.filter((r) => r.atRisk).slice(0, 5);
  if (atRisk.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md bg-muted/40 text-caption text-muted-foreground">
        <Users className="h-5 w-5" aria-hidden />
        No at-risk customers right now.
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {atRisk.map((r) => (
        <li
          key={r.customerId}
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
        >
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{r.name}</div>
            <div className="text-caption text-muted-foreground">
              {r.daysSinceLastBooking ?? "—"} days since last booking ·{" "}
              {r.totalBookings} bookings
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-display text-sm font-semibold tabular-nums text-foreground">
              {formatCurrency(r.totalSpend)}
            </div>
            <div className="text-caption text-muted-foreground">lifetime</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
