"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { AlertTriangle, Bike, Gauge, Wallet } from "lucide-react";
import { LegendDot, PipelineRow, StatShell } from "@/components/ui/stat-shell";
import { formatCurrency } from "@/lib/utils";

export interface FleetStatsData {
  total: number;
  available: number;
  rented: number;
  maintenance: number;
  other: number;
  bookValue: number;
  attention: {
    regoExpiring: number;
    ctpExpiring: number;
    insuranceExpiring: number;
    serviceDue: number;
  };
}

export function FleetStats({ data }: { data: FleetStatsData }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <TotalCard data={data} />
      <StatusCard data={data} />
      <UtilisationCard data={data} />
      <AttentionCard data={data} />
    </div>
  );
}

function TotalCard({ data }: { data: FleetStatsData }) {
  return (
    <StatShell title="Total fleet" icon={<Bike className="h-4 w-4" aria-hidden />}>
      <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
        {data.total.toLocaleString()}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Wallet className="h-3 w-3" aria-hidden />
        <span className="tabular-nums text-foreground">{formatCurrency(data.bookValue)}</span>
        <span>book value</span>
      </div>
    </StatShell>
  );
}

function StatusCard({ data }: { data: FleetStatsData }) {
  const total = data.available + data.rented + data.maintenance + data.other;
  return (
    <StatShell title="Status" icon={<Bike className="h-4 w-4" aria-hidden />}>
      {total === 0 ? (
        <div className="flex h-10 items-center text-sm text-muted-foreground">No vehicles</div>
      ) : (
        <>
          <div className="flex h-5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              style={{
                width: `${(data.available / total) * 100}%`,
                backgroundColor: "hsl(var(--staff-accent))",
              }}
            />
            <div
              style={{
                width: `${(data.rented / total) * 100}%`,
                backgroundColor: "hsl(var(--accent))",
              }}
            />
            <div
              style={{
                width: `${(data.maintenance / total) * 100}%`,
                backgroundColor: "hsl(var(--destructive))",
              }}
            />
            <div
              style={{
                width: `${(data.other / total) * 100}%`,
                backgroundColor: "hsl(var(--muted-foreground) / 0.35)",
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{data.available}</span> available
            </LegendDot>
            <LegendDot colorVar="--accent">
              <span className="tabular-nums text-foreground">{data.rented}</span> rented
            </LegendDot>
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{data.maintenance}</span> maint.
            </LegendDot>
            {data.other > 0 && (
              <LegendDot colorVar="--muted-foreground" opacity={0.5}>
                <span className="tabular-nums text-foreground">{data.other}</span> other
              </LegendDot>
            )}
          </div>
        </>
      )}
    </StatShell>
  );
}

function UtilisationCard({ data }: { data: FleetStatsData }) {
  const inService = data.rented + data.available;
  const pct = inService > 0 ? Math.round((data.rented / inService) * 100) : 0;
  const slices = [
    { name: "Rented", value: data.rented, color: "hsl(var(--accent))" },
    { name: "Available", value: data.available, color: "hsl(var(--muted-foreground) / 0.25)" },
  ];
  return (
    <StatShell title="Utilisation" icon={<Gauge className="h-4 w-4" aria-hidden />}>
      {inService === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No in-service fleet</div>
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
              <span className="font-display text-sm font-semibold leading-none tabular-nums">{pct}%</span>
            </div>
          </div>
          <div className="min-w-0 space-y-1 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(var(--accent))" }} aria-hidden />
              <span className="tabular-nums text-foreground">{data.rented}</span>
              <span className="text-muted-foreground">rented</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(var(--muted-foreground) / 0.25)" }} aria-hidden />
              <span className="tabular-nums text-foreground">{data.available}</span>
              <span className="text-muted-foreground">available</span>
            </div>
            <div className="pt-0.5 text-[10px] text-muted-foreground">{inService} in-service</div>
          </div>
        </div>
      )}
    </StatShell>
  );
}

function AttentionCard({ data }: { data: FleetStatsData }) {
  const { regoExpiring, ctpExpiring, insuranceExpiring, serviceDue } = data.attention;
  const sum = regoExpiring + ctpExpiring + insuranceExpiring + serviceDue;
  const denom = Math.max(1, data.total);
  return (
    <StatShell title="Needs attention" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
      {sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">All good ✅</div>
      ) : (
        <div className="space-y-2">
          <PipelineRow label="Rego expiring" value={regoExpiring} total={denom} colorVar="--destructive" />
          <PipelineRow label="Insurance expiring" value={insuranceExpiring} total={denom} colorVar="--destructive" />
          <PipelineRow label="Service due" value={serviceDue} total={denom} colorVar="--secondary" />
          {ctpExpiring > 0 && (
            <PipelineRow label="CTP expiring" value={ctpExpiring} total={denom} colorVar="--destructive" />
          )}
        </div>
      )}
    </StatShell>
  );
}
