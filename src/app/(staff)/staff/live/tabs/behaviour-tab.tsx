"use client";

import * as React from "react";
import { Activity, AlertOctagon, FileText, Gauge, Layers, LogOut, MousePointerClick, Percent, Search, Truck } from "lucide-react";
import { LoadingBlock, PipelineRow, StatShell } from "@/components/ui/stat-shell";
import { trpc } from "@/lib/trpc/client";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { downloadCsv } from "@/lib/analytics/csv";
import { AnalyticsFilterBar } from "./analytics-filter-bar";
import { DayHourHeatmap, RankedRow, useDrilldown } from "./analytics-shared";

export function BehaviourTab({ active }: { active: boolean }) {
  const { filters } = useAnalyticsFilters();
  const drilldown = useDrilldown();
  const query = trpc.liveAnalytics.behaviour.useQuery(
    {
      range: filters.range,
      segment: filters.segment,
      country: filters.country ?? undefined,
      landingPath: filters.landing ?? undefined,
      utmSource: filters.source ?? undefined,
      utmMedium: filters.medium ?? undefined,
      utmCampaign: filters.campaign ?? undefined,
      referrerDomain: filters.referrer ?? undefined,
      wizardStepEq: filters.step ?? undefined,
      hour: filters.hour ?? undefined,
      dow: filters.dow ?? undefined,
      pickupDepotId: filters.depot ?? undefined,
      categoryId: filters.category ?? undefined,
      vehicleId: filters.vehicle ?? undefined,
      discountCode: filters.code ?? undefined,
    },
    { enabled: active, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  const data = query.data;
  const loading = query.isLoading;

  const onExport = React.useCallback(() => {
    if (!data) return;
    downloadCsv(
      "analytics-behaviour",
      [
        ...data.topPages.map((p) => ({
          metric: "Top page",
          key: p.path,
          count: p.views,
          extra: p.avgMs ?? "",
        })),
        ...data.pageDepth.map((p) => ({
          metric: "Page depth",
          key: p.bucket,
          count: p.count,
          extra: "",
        })),
        ...data.dowHourMatrix.map((c) => ({
          metric: "DoW/hour",
          key: `${c.dow}/${c.hour}`,
          count: c.count,
          extra: "",
        })),
        ...data.scrollDepth.map((s) => ({
          metric: "Scroll depth",
          key: `${s.depth}%`,
          count: s.sessions,
          extra: "",
        })),
        {
          metric: "Engagement score avg",
          key: "",
          count: data.engagementScore.average ?? 0,
          extra: `sample=${data.engagementScore.sampleSize}`,
        },
        {
          metric: "Exit intent",
          key: "",
          count: data.engagementSignals.EXIT_INTENT ?? 0,
          extra: "",
        },
        {
          metric: "Rage click",
          key: "",
          count: data.engagementSignals.RAGE_CLICK ?? 0,
          extra: "",
        },
        {
          metric: "Dead click",
          key: "",
          count: data.engagementSignals.DEAD_CLICK ?? 0,
          extra: "",
        },
        ...data.topCtas.map((c) => ({
          metric: "Top CTA",
          key: c.target,
          count: c.count,
          extra: "",
        })),
        ...data.topFleetClicks.map((v) => ({
          metric: "Fleet click",
          key: v.label,
          count: v.count,
          extra: v.target,
        })),
        ...data.topFleetViews.map((v) => ({
          metric: "Fleet view",
          key: v.label,
          count: v.count,
          extra: v.target,
        })),
        ...data.topSearches.map((s) => ({
          metric: "Search",
          key: s.query,
          count: s.count,
          extra: "",
        })),
        ...data.discountFunnel.map((d) => ({
          metric: "Discount funnel",
          key: d.code,
          count: d.attempted,
          extra: `applied=${d.applied} rejected=${d.rejected}`,
        })),
      ],
      ["metric", "key", "count", "extra"],
    );
  }, [data]);

  return (
    <div className="space-y-4">
      <AnalyticsFilterBar
        description="Engagement signals — when visitors arrive, which pages they dwell on, and how deep they browse before leaving."
        onExport={onExport}
      />

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="h3 flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
            Day × hour traffic heatmap
          </h3>
          <p className="text-[10px] text-muted-foreground">Click any cell to drill into Sessions</p>
        </div>
        {loading || !data ? (
          <LoadingBlock className="h-40 w-full" />
        ) : (
          <DayHourHeatmap
            matrix={data.dowHourMatrix}
            onCellClick={(dow, hour) => drilldown({ dow, hour })}
          />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            Top pages
          </h3>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.topPages.length === 0 ? (
            <p className="text-xs text-muted-foreground">No page-view data yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-2 text-left font-normal">Path</th>
                  <th className="pb-2 text-right font-normal">Views</th>
                  <th className="pb-2 text-right font-normal">Avg time</th>
                </tr>
              </thead>
              <tbody>
                {data.topPages.map((p, i) => (
                  <tr key={`${p.path}-${i}`} className="border-t">
                    <td className="py-1.5 font-mono text-[11px]">{p.path}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.views.toLocaleString("en-AU")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {p.avgMs != null ? formatMs(p.avgMs) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
            Session depth
          </h3>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.pageDepth.every((p) => p.count === 0) ? (
            <p className="text-xs text-muted-foreground">No sessions in range.</p>
          ) : (
            <div className="space-y-2">
              {data.pageDepth.map((p) => (
                <PipelineRow
                  key={p.bucket}
                  label={`${p.bucket} page${p.bucket === "1" ? "" : "s"} viewed`}
                  value={p.count}
                  total={data.totalSessions}
                  colorVar="--primary"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatShell title="Engagement score" icon={<Gauge className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : data.engagementScore.average == null ? (
            <div className="text-xs text-muted-foreground">
              No finalised sessions yet — score is computed by the daily finalise pass.
            </div>
          ) : (
            <>
              <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {data.engagementScore.average}
                <span className="ml-1 text-sm text-muted-foreground">/ 100</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Across {data.engagementScore.sampleSize.toLocaleString("en-AU")} finalised sessions
              </p>
            </>
          )}
        </StatShell>
        <StatShell title="Exit intent" icon={<LogOut className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {(data.engagementSignals.EXIT_INTENT ?? 0).toLocaleString("en-AU")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Desktop mouseleave + mobile tab-switch
              </p>
            </>
          )}
        </StatShell>
        <StatShell title="Rage clicks" icon={<AlertOctagon className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {(data.engagementSignals.RAGE_CLICK ?? 0).toLocaleString("en-AU")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">≥3 clicks on the same element in 1s</p>
            </>
          )}
        </StatShell>
        <StatShell title="Dead clicks" icon={<MousePointerClick className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {(data.engagementSignals.DEAD_CLICK ?? 0).toLocaleString("en-AU")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Click on non-interactive element; no DOM change
              </p>
            </>
          )}
        </StatShell>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
          Scroll-depth reached
        </h3>
        {loading || !data ? (
          <LoadingBlock className="h-32 w-full" />
        ) : data.scrollDepth.every((s) => s.sessions === 0) ? (
          <p className="text-xs text-muted-foreground">
            No scroll-depth events yet. Visitors reaching ≥25% of any page will populate this chart.
          </p>
        ) : (
          <div className="space-y-2">
            {data.scrollDepth.map((s) => (
              <PipelineRow
                key={s.depth}
                label={`Reached ${s.depth}%`}
                value={s.sessions}
                total={data.totalSessions}
                colorVar="--primary"
                hint={
                  data.totalSessions > 0
                    ? `${((s.sessions / data.totalSessions) * 100).toFixed(0)}% of sessions`
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <EventCard
          title="Top CTAs clicked"
          icon={<MousePointerClick className="h-4 w-4" aria-hidden />}
          rows={data?.topCtas.map((r) => ({ id: r.target, label: r.target, count: r.count })) ?? []}
          loading={loading}
          emptyText="No CTA clicks yet. Instrument a data-track attribute to start collecting."
        />
        <EventCard
          title="Top vehicles viewed"
          icon={<Truck className="h-4 w-4" aria-hidden />}
          rows={
            data?.topFleetViews.map((v) => ({ id: v.target, label: v.label, count: v.count })) ?? []
          }
          loading={loading}
          onRowClick={(id) => id && drilldown({ vehicle: id })}
          emptyText="No fleet views recorded yet."
        />
        <EventCard
          title="Top vehicles clicked"
          icon={<Truck className="h-4 w-4" aria-hidden />}
          rows={
            data?.topFleetClicks.map((v) => ({ id: v.target, label: v.label, count: v.count })) ?? []
          }
          loading={loading}
          onRowClick={(id) => id && drilldown({ vehicle: id })}
          emptyText="No fleet clicks recorded yet."
        />
        <EventCard
          title="Top search queries"
          icon={<Search className="h-4 w-4" aria-hidden />}
          rows={data?.topSearches.map((s) => ({ id: s.query, label: s.query, count: s.count })) ?? []}
          loading={loading}
          emptyText="No searches submitted in range."
        />
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
          <Percent className="h-4 w-4 text-muted-foreground" aria-hidden />
          Discount-code funnel — attempted → applied → rejected
        </h3>
        {loading || !data ? (
          <LoadingBlock className="h-32 w-full" />
        ) : data.discountFunnel.length === 0 ? (
          <p className="text-xs text-muted-foreground">No discount codes entered in range.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-2 text-left font-normal">Code</th>
                <th className="pb-2 text-right font-normal">Attempted</th>
                <th className="pb-2 text-right font-normal">Applied</th>
                <th className="pb-2 text-right font-normal">Rejected</th>
                <th className="pb-2 text-right font-normal">Apply rate</th>
              </tr>
            </thead>
            <tbody>
              {data.discountFunnel.map((d) => {
                const rate = d.attempted > 0 ? d.applied / d.attempted : 0;
                return (
                  <tr key={d.code} className="border-t">
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => drilldown({ code: d.code })}
                        className="font-mono text-[11px] hover:text-primary"
                      >
                        {d.code}
                      </button>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {d.attempted.toLocaleString("en-AU")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {d.applied.toLocaleString("en-AU")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-red-600 dark:text-red-400">
                      {d.rejected.toLocaleString("en-AU")}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {(rate * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EventCard({
  title,
  icon,
  rows,
  loading,
  onRowClick,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ id: string; label: string; count: number }>;
  loading: boolean;
  onRowClick?: (id: string) => void;
  emptyText: string;
}) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </h3>
      {loading ? (
        <LoadingBlock className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <RankedRow
              key={`${r.id}-${i}`}
              label={r.label}
              value={r.count}
              total={total}
              onClick={onRowClick ? () => onRowClick(r.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${Math.round(seconds - m * 60)}s`;
}
