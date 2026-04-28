"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { Activity, Eye, MessageCircle, TrendingUp } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface LiveStatsData {
  activeVisitors: number;
  activeChats: number;
  byWizardStep: Record<string, number>;
  funnel: { landed: number; configuring: number; checkout: number; converted: number };
  todayStarted: number;
  convertedToday: number;
}

const STEP_COLORS = [
  "--muted-foreground",
  "--accent",
  "--secondary",
  "--staff-accent",
  "--primary",
  "--admin-accent",
];

export function LiveStats({ data, loading }: { data?: LiveStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <ActiveCard data={data} loading={loading} />
      <StepCard data={data?.byWizardStep} loading={loading} />
      <FunnelCard data={data?.funnel} loading={loading} />
      <ConversionCard data={data} loading={loading} />
    </div>
  );
}

function ActiveCard({ data, loading }: { data?: LiveStatsData; loading?: boolean }) {
  return (
    <StatShell title="Active visitors" icon={<Eye className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-24" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.activeVisitors.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.activeChats} in chat · {data.todayStarted} session{data.todayStarted === 1 ? "" : "s"} today
          </div>
        </>
      )}
    </StatShell>
  );
}

const STEP_LABELS: Record<string, string> = {
  landing: "Landing",
  step1: "Search",
  step2: "Vehicle",
  step3: "Extras",
  step4: "Details",
  step5: "Review",
  step6: "Payment",
};

function StepCard({ data, loading }: { data?: Record<string, number>; loading?: boolean }) {
  const keys = ["landing", "step1", "step2", "step3", "step4", "step5", "step6"];
  const entries = keys.map((k, i) => ({
    key: k,
    label: STEP_LABELS[k] ?? k,
    value: data?.[k] ?? 0,
    colorVar: STEP_COLORS[i] ?? "--muted-foreground",
  }));
  return (
    <StatShell title="Wizard steps" icon={<Activity className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={entries.map((e) => ({ value: e.value, colorVar: e.colorVar }))}
          />
          <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
            {entries.filter((e) => e.value > 0).map((e) => (
              <LegendDot key={e.key} colorVar={e.colorVar}>
                <span className="tabular-nums text-foreground">{e.value}</span> {e.label.toLowerCase()}
              </LegendDot>
            ))}
          </div>
        </>
      )}
    </StatShell>
  );
}

function FunnelCard({ data, loading }: { data?: LiveStatsData["funnel"]; loading?: boolean }) {
  const slices = [
    { name: "Landed", value: data?.landed ?? 0, color: "hsl(var(--muted-foreground) / 0.5)" },
    { name: "Configuring", value: data?.configuring ?? 0, color: "hsl(var(--accent))" },
    { name: "Checkout", value: data?.checkout ?? 0, color: "hsl(var(--secondary))" },
    { name: "Converted", value: data?.converted ?? 0, color: "hsl(var(--staff-accent))" },
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  const rate = sum > 0 ? Math.round(((data?.converted ?? 0) / sum) * 100) : 0;
  return (
    <StatShell title="Today's funnel" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No sessions yet</div>
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

function ConversionCard({ data, loading }: { data?: LiveStatsData; loading?: boolean }) {
  const total = Math.max(1, data?.todayStarted ?? 0);
  return (
    <StatShell title="Conversion today" icon={<MessageCircle className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2">
          <PipelineRow
            label="Reached checkout"
            value={data.funnel.checkout}
            total={total}
            colorVar="--secondary"
          />
          <PipelineRow
            label="Converted"
            value={data.convertedToday}
            total={total}
            colorVar="--staff-accent"
            hint="paid bookings from web"
          />
        </div>
      )}
    </StatShell>
  );
}
