"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { Activity, AlertTriangle, CalendarClock, Gauge } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface CalendarStatsData {
  activeRentals: number;
  todayPickups: number;
  todayReturns: number;
  overdue: number;
  utilisation: {
    rented: number;
    available: number;
    maintenance: number;
    offFleet: number;
  };
}

export function CalendarStats({ data, loading }: { data?: CalendarStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <ActiveCard data={data} loading={loading} />
      <FlowCard data={data} loading={loading} />
      <UtilisationCard data={data?.utilisation} loading={loading} />
      <OverdueCard data={data} loading={loading} />
    </div>
  );
}

function ActiveCard({ data, loading }: { data?: CalendarStatsData; loading?: boolean }) {
  return (
    <StatShell title="Active rentals" icon={<Activity className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-24" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.activeRentals.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.todayPickups} picking up today · {data.todayReturns} returning
          </div>
        </>
      )}
    </StatShell>
  );
}

function FlowCard({ data, loading }: { data?: CalendarStatsData; loading?: boolean }) {
  return (
    <StatShell title="Today's flow" icon={<CalendarClock className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.todayPickups, colorVar: "--staff-accent" },
              { value: data.todayReturns, colorVar: "--accent" },
              { value: data.overdue, colorVar: "--destructive" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{data.todayPickups}</span> pickups
            </LegendDot>
            <LegendDot colorVar="--accent">
              <span className="tabular-nums text-foreground">{data.todayReturns}</span> returns
            </LegendDot>
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{data.overdue}</span> overdue
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function UtilisationCard({
  data,
  loading,
}: {
  data?: CalendarStatsData["utilisation"];
  loading?: boolean;
}) {
  const slices = [
    { name: "Rented", value: data?.rented ?? 0, color: "hsl(var(--staff-accent))" },
    { name: "Available", value: data?.available ?? 0, color: "hsl(var(--accent))" },
    { name: "Maintenance", value: data?.maintenance ?? 0, color: "hsl(var(--secondary))" },
    { name: "Off-fleet", value: data?.offFleet ?? 0, color: "hsl(var(--muted-foreground) / 0.35)" },
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  const util = sum > 0 ? Math.round(((data?.rented ?? 0) / sum) * 100) : 0;
  return (
    <StatShell title="Fleet utilisation" icon={<Gauge className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No vehicles</div>
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
              <span className="font-display text-sm font-semibold leading-none tabular-nums">{util}%</span>
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

function OverdueCard({ data, loading }: { data?: CalendarStatsData; loading?: boolean }) {
  return (
    <StatShell title="Overdue watch" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="Overdue returns"
            value={data.overdue}
            total={Math.max(1, data.activeRentals + data.overdue)}
            colorVar="--destructive"
            hint="past return time"
          />
          <PipelineRow
            label="Active on-fleet"
            value={data.activeRentals}
            total={Math.max(1, data.activeRentals + data.overdue)}
            colorVar="--staff-accent"
          />
        </div>
      )}
    </StatShell>
  );
}
