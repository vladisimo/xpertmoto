"use client";

import * as React from "react";
import { Activity, Eye, Smartphone, TrendingUp } from "lucide-react";
import {
  LegendDot,
  LoadingBlock,
  MiniStackedBar,
  PipelineRow,
  StatShell,
} from "@/components/ui/stat-shell";
import { trpc } from "@/lib/trpc/client";
import { StatusBadge } from "@/components/ui/status-badge";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { downloadCsv } from "@/lib/analytics/csv";
import { AnalyticsFilterBar } from "./analytics-filter-bar";
import {
  DayHourHeatmap,
  DeltaBadge,
  useDrilldown,
} from "./analytics-shared";

const WIZARD_STEP_LABELS = ["Search", "Vehicle", "Extras", "Details", "Review", "Payment"];
const DEVICE_COLORS = ["--primary", "--accent", "--secondary", "--muted-foreground"];

export function OverviewTab({ active }: { active: boolean }) {
  const { filters } = useAnalyticsFilters();
  const drilldown = useDrilldown();
  const query = trpc.liveAnalytics.overviewSummary.useQuery(
    {
      range: filters.range,
      compare: filters.compare,
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
    const rows = [
      { metric: "Total sessions", current: data.totals.totalSessions, previous: data.previousTotals?.totalSessions ?? "" },
      { metric: "Unique visitors", current: data.totals.uniqueVisitors, previous: data.previousTotals?.uniqueVisitors ?? "" },
      { metric: "Conversion rate", current: data.totals.conversionRate, previous: data.previousTotals?.conversionRate ?? "" },
      { metric: "Avg duration (s)", current: data.totals.avgDurationSeconds, previous: data.previousTotals?.avgDurationSeconds ?? "" },
      { metric: "Bounced", current: data.totals.bounced, previous: data.previousTotals?.bounced ?? "" },
      { metric: "Abandoned wizard", current: data.totals.abandonedWizard, previous: data.previousTotals?.abandonedWizard ?? "" },
      { metric: "Left", current: data.totals.left, previous: data.previousTotals?.left ?? "" },
      { metric: "Converted", current: data.totals.converted, previous: data.previousTotals?.converted ?? "" },
    ];
    downloadCsv("analytics-overview", rows);
  }, [data]);

  return (
    <div className="space-y-4">
      <AnalyticsFilterBar
        description="Summary metrics with optional previous-period comparison, device mix, wizard funnel, and day × hour traffic heatmap."
        onExport={onExport}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatShell title="Total sessions" icon={<Eye className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                  {data.totals.totalSessions.toLocaleString("en-AU")}
                </div>
                <DeltaBadge current={data.totals.totalSessions} previous={data.previousTotals?.totalSessions} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.totals.uniqueVisitors.toLocaleString("en-AU")} unique visitors
              </p>
            </>
          )}
        </StatShell>

        <StatShell title="Conversion" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                  {(data.totals.conversionRate * 100).toFixed(1)}%
                </div>
                <DeltaBadge
                  current={data.totals.conversionRate}
                  previous={data.previousTotals?.conversionRate}
                  format="pp-delta"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.totals.converted.toLocaleString("en-AU")} bookings ·{" "}
                {data.totals.abandonedWizard.toLocaleString("en-AU")} abandoned wizard
              </p>
            </>
          )}
        </StatShell>

        <StatShell title="Avg session" icon={<Activity className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                  {formatDuration(data.totals.avgDurationSeconds)}
                </div>
                <DeltaBadge
                  current={data.totals.avgDurationSeconds}
                  previous={data.previousTotals?.avgDurationSeconds}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Ended sessions only</p>
            </>
          )}
        </StatShell>

        <StatShell title="Device mix" icon={<Smartphone className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-full" />
          ) : (
            <>
              <MiniStackedBar
                segments={(data.device ?? []).map((d, i) => ({
                  value: d.count,
                  colorVar: pickColor(DEVICE_COLORS, i),
                  label: d.type ?? "Unknown",
                }))}
              />
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                {(data.device ?? []).map((d, i) => (
                  <LegendDot key={d.type ?? `u${i}`} colorVar={pickColor(DEVICE_COLORS, i)}>
                    {d.type ?? "Unknown"} · {d.count}
                  </LegendDot>
                ))}
              </div>
            </>
          )}
        </StatShell>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="rounded-lg border bg-card p-4 shadow-sm xl:col-span-2">
          <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
            Wizard funnel
          </h3>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : (
            <div className="space-y-2">
              {data.funnel.map((f, i) => (
                <PipelineRow
                  key={f.step}
                  label={`Step ${f.step} · ${WIZARD_STEP_LABELS[f.step - 1]}`}
                  value={f.reached}
                  total={data.totals.totalSessions}
                  colorVar={pickColor(["--primary", "--accent"], i)}
                  hint={
                    f.dropOffRate != null
                      ? `${(f.dropOffRate * 100).toFixed(0)}% drop-off`
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm xl:col-span-3">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="h3 flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
              Traffic heatmap — day × hour
            </h3>
            <p className="text-[10px] text-muted-foreground">Click a cell to drill into Sessions</p>
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
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="h3 mb-3 text-sm">Outcome breakdown</h3>
        {loading || !data ? (
          <LoadingBlock className="h-8 w-full" />
        ) : (
          <OutcomeBar totals={data.totals} />
        )}
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="h3 mb-1 text-sm">Benchmarks — conversion by device</h3>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Share of sessions on each device that converted during this range. Helpful for
          spotting a mobile-vs-desktop gap at a glance.
        </p>
        {loading || !data ? (
          <LoadingBlock className="h-24 w-full" />
        ) : data.deviceBenchmarks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No device data in range.</p>
        ) : (
          <BenchmarkStrip rows={data.deviceBenchmarks} />
        )}
      </div>
    </div>
  );
}

function BenchmarkStrip({
  rows,
}: {
  rows: Array<{ deviceType: string; total: number; converted: number; conversionRate: number }>;
}) {
  const sorted = [...rows].sort((a, b) => b.conversionRate - a.conversionRate);
  const best = sorted[0];
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {sorted.map((r) => {
        const isBest = best && r.deviceType === best.deviceType && sorted.length > 1;
        return (
          <div
            key={r.deviceType}
            className="rounded-md border bg-card p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {r.deviceType}
              </span>
              {isBest && <StatusBadge status="BEST" />}
            </div>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
              {(r.conversionRate * 100).toFixed(2)}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.converted.toLocaleString("en-AU")} of {r.total.toLocaleString("en-AU")}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function OutcomeBar({
  totals,
}: {
  totals: {
    totalSessions: number;
    converted: number;
    abandonedWizard: number;
    bounced: number;
    left: number;
  };
}) {
  const segments = [
    { label: "Converted", value: totals.converted, colorVar: "--primary" },
    { label: "Abandoned wizard", value: totals.abandonedWizard, colorVar: "--accent" },
    { label: "Bounced", value: totals.bounced, colorVar: "--secondary" },
    { label: "Left", value: totals.left, colorVar: "--muted-foreground" },
  ];
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return <p className="text-xs text-muted-foreground">No sessions in range.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full"
            style={{
              width: `${(s.value / total) * 100}%`,
              backgroundColor: `hsl(var(${s.colorVar}))`,
            }}
            title={`${s.label}: ${s.value.toLocaleString("en-AU")}`}
            aria-label={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        {segments.map((s) => (
          <LegendDot key={s.label} colorVar={s.colorVar}>
            {s.label} · {s.value.toLocaleString("en-AU")} ({((s.value / total) * 100).toFixed(0)}%)
          </LegendDot>
        ))}
      </div>
    </div>
  );
}

function pickColor(arr: string[], i: number): string {
  return arr[i % arr.length] ?? arr[0] ?? "--primary";
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
