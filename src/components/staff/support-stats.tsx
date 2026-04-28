"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { Clock, Inbox, ShieldAlert, Layers } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface SupportStatsData {
  open: number;
  unassigned: number;
  byPriority: { low: number; normal: number; high: number; urgent: number };
  byCategory: Record<string, number>;
  aged: { under24h: number; under3d: number; over3d: number };
  oldestOpenAt: string | null;
}

const CATEGORY_COLORS = ["hsl(var(--staff-accent))", "hsl(var(--accent))", "hsl(var(--secondary))", "hsl(var(--destructive))"];

export function SupportStats({ data, loading }: { data?: SupportStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <OpenCard data={data} loading={loading} />
      <PriorityCard data={data?.byPriority} loading={loading} />
      <CategoryCard data={data?.byCategory} loading={loading} />
      <AgedCard data={data} loading={loading} />
    </div>
  );
}

function OpenCard({ data, loading }: { data?: SupportStatsData; loading?: boolean }) {
  return (
    <StatShell title="Open tickets" icon={<Inbox className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-24" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.open.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.byPriority.urgent} urgent · {data.byPriority.high} high · {data.unassigned} unassigned
          </div>
        </>
      )}
    </StatShell>
  );
}

function PriorityCard({
  data,
  loading,
}: {
  data?: SupportStatsData["byPriority"];
  loading?: boolean;
}) {
  return (
    <StatShell title="Priority mix" icon={<ShieldAlert className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.urgent, colorVar: "--destructive" },
              { value: data.high, colorVar: "--secondary" },
              { value: data.normal, colorVar: "--staff-accent" },
              { value: data.low, colorVar: "--muted-foreground", opacity: 0.45 },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{data.urgent}</span> urgent
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{data.high}</span> high
            </LegendDot>
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{data.normal}</span> normal
            </LegendDot>
            <LegendDot colorVar="--muted-foreground" opacity={0.45}>
              <span className="tabular-nums text-foreground">{data.low}</span> low
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function CategoryCard({ data, loading }: { data?: Record<string, number>; loading?: boolean }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 4);
  const rest = entries.slice(4).reduce((a, [, v]) => a + v, 0);
  const slices = [
    ...top.map(([name, value], i) => ({ name, value, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] })),
    ...(rest > 0 ? [{ name: "Other", value: rest, color: "hsl(var(--muted-foreground) / 0.35)" }] : []),
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  return (
    <StatShell title="Category mix" icon={<Layers className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No open tickets</div>
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
              <span className="font-display text-sm font-semibold leading-none tabular-nums">{sum}</span>
            </div>
          </div>
          <div className="min-w-0 space-y-1 text-[11px]">
            {slices.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="tabular-nums text-foreground">{s.value}</span>
                <span className="truncate text-muted-foreground">{s.name.toLowerCase().replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </StatShell>
  );
}

function AgedCard({ data, loading }: { data?: SupportStatsData; loading?: boolean }) {
  return (
    <StatShell title="Age of open tickets" icon={<Clock className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2">
          <PipelineRow
            label="<24h"
            value={data.aged.under24h}
            total={Math.max(1, data.open)}
            colorVar="--staff-accent"
          />
          <PipelineRow
            label="1–3 days"
            value={data.aged.under3d}
            total={Math.max(1, data.open)}
            colorVar="--secondary"
          />
          <PipelineRow
            label=">3 days"
            value={data.aged.over3d}
            total={Math.max(1, data.open)}
            colorVar="--destructive"
          />
        </div>
      )}
    </StatShell>
  );
}
