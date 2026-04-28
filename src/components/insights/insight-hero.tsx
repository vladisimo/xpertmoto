"use client";

import * as React from "react";
import { Clock, Sparkles, AlertCircle, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatShell } from "@/components/ui/stat-shell";
import type { InsightsOverview } from "@/server/services/insights/types";

interface Props {
  overview: InsightsOverview | undefined;
  onRefresh: () => void;
  refreshing: boolean;
  error: string | null;
}

export function InsightHero({ overview, onRefresh, refreshing, error }: Props) {
  const ready = overview?.readiness.sufficient ?? true;
  const highCount =
    overview?.cards.filter((c) => c.narrative.priority === "HIGH").length ?? 0;
  const avgConfidence =
    overview && overview.cards.length > 0
      ? overview.cards.reduce((a, c) => a + c.narrative.confidence, 0) /
        overview.cards.length
      : 0;
  const generatedLabel = overview
    ? ready
      ? formatRelative(new Date(overview.generatedAt))
      : "—"
    : "—";

  return (
    <div
      className="space-y-4 rounded-lg border p-4"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--insights-accent) / 0.10), hsl(var(--insights-accent-soft) / 0.05) 60%, hsl(var(--card)))",
        borderColor: "hsl(var(--insights-accent) / 0.25)",
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatShell
          title="High-priority insights"
          icon={
            <AlertCircle
              className="h-4 w-4"
              style={{ color: "hsl(var(--insights-accent))" }}
              aria-hidden
            />
          }
        >
          <div
            className="font-display text-3xl font-semibold tabular-nums"
            style={{ color: "hsl(var(--insights-accent))" }}
          >
            {ready ? highCount : "—"}
          </div>
          <div className="mt-1 text-caption text-muted-foreground">
            {ready
              ? "Findings worth acting on this week"
              : "Awaiting sufficient data"}
          </div>
        </StatShell>

        <StatShell
          title="Average confidence"
          icon={
            <Sparkles
              className="h-4 w-4"
              style={{ color: "hsl(var(--insights-accent))" }}
              aria-hidden
            />
          }
        >
          <div
            className="font-display text-3xl font-semibold tabular-nums"
            style={{ color: "hsl(var(--insights-accent))" }}
          >
            {ready ? `${Math.round(avgConfidence * 100)}%` : "—"}
          </div>
          <div className="mt-1 text-caption text-muted-foreground">
            {ready
              ? `Across ${overview?.cards.length ?? 0} insights`
              : "No insights generated yet"}
          </div>
        </StatShell>

        <StatShell
          title="Last generated"
          icon={<Clock className="h-4 w-4" aria-hidden />}
        >
          <div className="font-display text-xl font-semibold tabular-nums text-foreground">
            {generatedLabel}
          </div>
          <div className="mt-1 text-caption text-muted-foreground">
            {!ready
              ? "Waiting on more data"
              : overview?.stale
                ? "Stale — regenerate when convenient"
                : "Cached from the nightly refresh"}
          </div>
        </StatShell>

        <StatShell
          title="Scope"
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
        >
          <div className="font-display text-xl font-semibold text-foreground">
            {overview?.scopeLabel ?? "—"}
          </div>
          <div className="mt-3">
            <Button
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              className="w-full text-white hover:opacity-90"
              style={{ backgroundColor: "hsl(var(--insights-accent))" }}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCcw className="h-4 w-4" aria-hidden />
              )}
              <span className="ml-2">
                {refreshing ? "Generating…" : "Refresh insights"}
              </span>
            </Button>
          </div>
        </StatShell>
      </div>
      {error && (
        <p className="text-caption text-destructive">{error}</p>
      )}
    </div>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
