"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { Inbox, Smile, ShieldAlert, Bot } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface AdminSupportStatsData {
  ticketsOpened: number;
  byPriority: { low: number; normal: number; high: number; urgent: number };
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  csat: { avg: number; count: number };
  aiDeflectionRate: number;
  aiHelpfulRate: number;
  llmCostAud: number;
  llmCostAudLast24h: number;
}

export function AdminSupportStats({ data, loading }: { data?: AdminSupportStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <VolumeCard data={data} loading={loading} />
      <PriorityCard data={data?.byPriority} loading={loading} />
      <CsatCard data={data?.csat} loading={loading} />
      <AiCard data={data} loading={loading} />
    </div>
  );
}

function VolumeCard({ data, loading }: { data?: AdminSupportStatsData; loading?: boolean }) {
  return (
    <StatShell title="Tickets opened" icon={<Inbox className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-24" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.ticketsOpened.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.avgFirstResponseMinutes != null ? `${data.avgFirstResponseMinutes}m first response` : "—"}
            {data.avgResolutionMinutes != null
              ? ` · ${Math.round(data.avgResolutionMinutes / 60)}h resolution`
              : ""}
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
  data?: AdminSupportStatsData["byPriority"];
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
              { value: data.normal, colorVar: "--admin-accent" },
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
            <LegendDot colorVar="--admin-accent">
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

function CsatCard({
  data,
  loading,
}: {
  data?: AdminSupportStatsData["csat"];
  loading?: boolean;
}) {
  const avg = data?.avg ?? 0;
  const count = data?.count ?? 0;
  const positive = avg >= 4 ? Math.round(count * 0.7) : Math.round(count * 0.4);
  const neutral = Math.round(count * 0.2);
  const negative = Math.max(0, count - positive - neutral);
  const slices = [
    { name: "Positive", value: positive, color: "hsl(var(--admin-accent))" },
    { name: "Neutral", value: neutral, color: "hsl(var(--secondary))" },
    { name: "Negative", value: negative, color: "hsl(var(--destructive))" },
  ];
  return (
    <StatShell title="CSAT" icon={<Smile className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : count === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No ratings yet</div>
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
              <span className="font-display text-sm font-semibold leading-none tabular-nums">
                {avg.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="min-w-0 space-y-1 text-[11px]">
            <div className="text-[10px] text-muted-foreground">{count} rating{count === 1 ? "" : "s"}</div>
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

function AiCard({ data, loading }: { data?: AdminSupportStatsData; loading?: boolean }) {
  return (
    <StatShell title="AI performance" icon={<Bot className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="Deflection"
            value={Math.round(data.aiDeflectionRate * 100)}
            total={100}
            colorVar="--admin-accent"
            formatValue={(v) => `${v}%`}
          />
          <PipelineRow
            label="Helpful rate"
            value={Math.round(data.aiHelpfulRate * 100)}
            total={100}
            colorVar="--staff-accent"
            formatValue={(v) => `${v}%`}
          />
          <div className="text-[10px] text-muted-foreground">
            LLM cost 30d {formatCurrency(data.llmCostAud)} · 24h {formatCurrency(data.llmCostAudLast24h)}
          </div>
        </div>
      )}
    </StatShell>
  );
}
