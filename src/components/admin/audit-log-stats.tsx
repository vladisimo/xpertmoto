"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { Activity, AlertOctagon, CheckCircle2, GitCommit } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export type AuditStatsRange = "24h" | "7d" | "14d" | "30d" | "90d";

const RANGE_LABEL: Record<AuditStatsRange, string> = {
  "24h": "last 24h",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
};

export interface AuditLogStatsData {
  range: AuditStatsRange;
  eventsInRange: number;
  byCategory: {
    auth: number;
    pageView: number;
    mutation: number;
    query: number;
    job: number;
    api: number;
    webhook: number;
  };
  byStatus: { success: number; failure: number; denied: number };
  mutationsInRange: number;
  queriesInRange: number;
  failedInRange: number;
  deniedInRange: number;
}

export function AuditLogStats({ data, loading }: { data?: AuditLogStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <EventsCard data={data} loading={loading} />
      <CategoryCard data={data?.byCategory} loading={loading} />
      <OutcomeCard data={data?.byStatus} loading={loading} />
      <MutationsCard data={data} loading={loading} />
    </div>
  );
}

function EventsCard({ data, loading }: { data?: AuditLogStatsData; loading?: boolean }) {
  return (
    <StatShell title="Events" icon={<Activity className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-28" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.eventsInRange.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {RANGE_LABEL[data.range]} · {data.failedInRange} failed · {data.deniedInRange} denied
          </div>
        </>
      )}
    </StatShell>
  );
}

function CategoryCard({
  data,
  loading,
}: {
  data?: AuditLogStatsData["byCategory"];
  loading?: boolean;
}) {
  return (
    <StatShell title="Category split" icon={<GitCommit className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.auth, colorVar: "--admin-accent" },
              { value: data.mutation, colorVar: "--accent" },
              { value: data.query, colorVar: "--muted-foreground", opacity: 0.45 },
              { value: data.api, colorVar: "--secondary" },
              { value: data.webhook, colorVar: "--staff-accent" },
              { value: data.job, colorVar: "--muted-foreground", opacity: 0.65 },
              { value: data.pageView, colorVar: "--muted-foreground", opacity: 0.3 },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">
              <span className="tabular-nums text-foreground">{data.auth}</span> auth
            </LegendDot>
            <LegendDot colorVar="--accent">
              <span className="tabular-nums text-foreground">{data.mutation}</span> mutation
            </LegendDot>
            <LegendDot colorVar="--muted-foreground" opacity={0.45}>
              <span className="tabular-nums text-foreground">{data.query}</span> query
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{data.api}</span> api
            </LegendDot>
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{data.webhook}</span> webhook
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function OutcomeCard({
  data,
  loading,
}: {
  data?: AuditLogStatsData["byStatus"];
  loading?: boolean;
}) {
  const slices = [
    { name: "Success", value: data?.success ?? 0, color: "hsl(var(--admin-accent))" },
    { name: "Failure", value: data?.failure ?? 0, color: "hsl(var(--destructive))" },
    { name: "Denied", value: data?.denied ?? 0, color: "hsl(var(--secondary))" },
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  const rate = sum > 0 ? Math.round(((data?.success ?? 0) / sum) * 100) : 0;
  return (
    <StatShell title="Outcome" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No events</div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            <PieChart width={64} height={64}>
              <Pie data={slices} dataKey="value" innerRadius={20} outerRadius={32} paddingAngle={2} stroke="none" isAnimationActive={false}>
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-sm font-semibold leading-none tabular-nums">{rate}%</span>
            </div>
          </div>
          <div className="min-w-0 space-y-1 text-[11px]">
            {slices.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="tabular-nums text-foreground">{s.value}</span>
                <span className="text-muted-foreground">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </StatShell>
  );
}

function MutationsCard({ data, loading }: { data?: AuditLogStatsData; loading?: boolean }) {
  return (
    <StatShell title="Write activity" icon={<AlertOctagon className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="Mutations"
            value={data.mutationsInRange}
            total={Math.max(1, data.eventsInRange)}
            colorVar="--accent"
            hint={RANGE_LABEL[data.range]}
          />
          <PipelineRow
            label="Failed"
            value={data.failedInRange}
            total={Math.max(1, data.eventsInRange)}
            colorVar="--destructive"
          />
        </div>
      )}
    </StatShell>
  );
}
