"use client";

import * as React from "react";
import { Clock, UserCheck, UserPlus, Users } from "lucide-react";
import {
  LegendDot,
  LoadingBlock,
  MiniStackedBar,
  PipelineRow,
  StatShell,
} from "@/components/ui/stat-shell";
import { trpc } from "@/lib/trpc/client";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { downloadCsv } from "@/lib/analytics/csv";
import { AnalyticsFilterBar } from "./analytics-filter-bar";

export function RetentionTab({ active }: { active: boolean }) {
  const { filters } = useAnalyticsFilters();
  const query = trpc.liveAnalytics.retention.useQuery(
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
      "analytics-retention",
      [
        { metric: "New visitors", key: "", count: data.newVisitors, rate: "" },
        { metric: "Returning visitors", key: "", count: data.returningVisitors, rate: "" },
        { metric: "Registered users", key: "", count: data.registered, rate: "" },
        { metric: "Guest sessions", key: "", count: data.guest, rate: "" },
        ...data.cohorts.map((c) => ({
          metric: "Cohort",
          key: c.label,
          count: c.sessions,
          rate: c.conversionRate,
        })),
        ...data.daysToConvert.map((d) => ({
          metric: "Days to convert",
          key: d.bucket,
          count: d.count,
          rate: "",
        })),
      ],
      ["metric", "key", "count", "rate"],
    );
  }, [data]);

  const newReturningTotal = (data?.newVisitors ?? 0) + (data?.returningVisitors ?? 0);

  return (
    <div className="space-y-4">
      <AnalyticsFilterBar
        description="Repeat-visitor and cohort analysis driven by the persistent sc_visitor cookie (Slice 2). New visitors are first-session; returning are session 2+."
        onExport={onExport}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatShell title="Total sessions" icon={<Users className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
              {data.totalSessions.toLocaleString("en-AU")}
            </div>
          )}
        </StatShell>
        <StatShell title="New visitors" icon={<UserPlus className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {data.newVisitors.toLocaleString("en-AU")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {newReturningTotal > 0
                  ? `${((data.newVisitors / newReturningTotal) * 100).toFixed(0)}% of sessions`
                  : "—"}
              </p>
            </>
          )}
        </StatShell>
        <StatShell title="Returning visitors" icon={<UserCheck className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {data.returningVisitors.toLocaleString("en-AU")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {newReturningTotal > 0
                  ? `${((data.returningVisitors / newReturningTotal) * 100).toFixed(0)}% of sessions`
                  : "—"}
              </p>
            </>
          )}
        </StatShell>
        <StatShell title="Registered users" icon={<UserCheck className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-24" />
          ) : (
            <>
              <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {data.registered.toLocaleString("en-AU")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.guest.toLocaleString("en-AU")} guest sessions
              </p>
            </>
          )}
        </StatShell>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="h3 mb-3 text-sm">New vs returning</h3>
          {loading || !data ? (
            <LoadingBlock className="h-10 w-full" />
          ) : newReturningTotal === 0 ? (
            <p className="text-xs text-muted-foreground">No sessions in range.</p>
          ) : (
            <>
              <MiniStackedBar
                height="h-3"
                segments={[
                  { value: data.newVisitors, colorVar: "--primary", label: "New" },
                  { value: data.returningVisitors, colorVar: "--accent", label: "Returning" },
                ]}
              />
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <LegendDot colorVar="--primary">
                  New · {data.newVisitors.toLocaleString("en-AU")}
                </LegendDot>
                <LegendDot colorVar="--accent">
                  Returning · {data.returningVisitors.toLocaleString("en-AU")}
                </LegendDot>
              </div>
            </>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
            Days from first visit to conversion
          </h3>
          {loading || !data ? (
            <LoadingBlock className="h-32 w-full" />
          ) : data.daysToConvertTotal === 0 ? (
            <p className="text-xs text-muted-foreground">
              No returning-visitor conversions in range.
            </p>
          ) : (
            <div className="space-y-2">
              {data.daysToConvert.map((d) => (
                <PipelineRow
                  key={d.bucket}
                  label={d.bucket}
                  value={d.count}
                  total={data.daysToConvertTotal}
                  colorVar="--primary"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="h3 mb-3 text-sm">Session-number cohort conversion</h3>
        {loading || !data ? (
          <LoadingBlock className="h-32 w-full" />
        ) : data.cohorts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sessions in range.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-2 text-left font-normal">Cohort</th>
                <th className="pb-2 text-right font-normal">Sessions</th>
                <th className="pb-2 text-right font-normal">Converted</th>
                <th className="pb-2 text-right font-normal">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c) => (
                <tr key={c.cohort} className="border-t">
                  <td className="py-1.5 font-medium">{c.label}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {c.sessions.toLocaleString("en-AU")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {c.converted.toLocaleString("en-AU")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {(c.conversionRate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
