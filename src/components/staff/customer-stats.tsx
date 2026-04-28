"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { ShieldCheck, ShieldAlert, Users, Activity, Clock } from "lucide-react";
import { LegendDot, LoadingBlock, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface CustomerStatsData {
  total: number;
  verified: number;
  unverified: number;
  licenceExpired: number;
  licenceExpiringSoon: number;
  risk: { low: number; medium: number; high: number };
  pendingHire: number;
  activeRental: number;
  suspended: number;
}

export function CustomerStats({ data, loading }: { data?: CustomerStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <TotalCard value={data?.total} loading={loading} />
      <LicenceCard data={data} loading={loading} />
      <RiskCard data={data?.risk} total={data?.total ?? 0} loading={loading} />
      <PipelineCard data={data} loading={loading} />
    </div>
  );
}

function TotalCard({ value, loading }: { value?: number; loading?: boolean }) {
  return (
    <StatShell title="Total customers" icon={<Users className="h-4 w-4" aria-hidden />}>
      {loading || value === undefined ? (
        <LoadingBlock className="h-10 w-24" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {value.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Registered customer accounts</div>
        </>
      )}
    </StatShell>
  );
}

function LicenceCard({ data, loading }: { data?: CustomerStatsData; loading?: boolean }) {
  const verified = data?.verified ?? 0;
  const unverified = data?.unverified ?? 0;
  const expired = data?.licenceExpired ?? 0;
  const total = verified + unverified;
  const verifiedActive = Math.max(0, verified - expired);
  return (
    <StatShell title="Licence status" icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-full" />
      ) : total === 0 ? (
        <div className="flex h-10 items-center text-sm text-muted-foreground">No customers yet</div>
      ) : (
        <>
          <div className="flex h-5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              style={{
                width: `${(verifiedActive / total) * 100}%`,
                backgroundColor: "hsl(var(--staff-accent))",
              }}
            />
            <div
              style={{
                width: `${(expired / total) * 100}%`,
                backgroundColor: "hsl(var(--destructive))",
              }}
            />
            <div
              style={{
                width: `${(unverified / total) * 100}%`,
                backgroundColor: "hsl(var(--muted-foreground) / 0.35)",
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{Math.max(0, verified - expired)}</span> verified
            </LegendDot>
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{expired}</span> expired
            </LegendDot>
            <LegendDot colorVar="--muted-foreground" opacity={0.5}>
              <span className="tabular-nums text-foreground">{unverified}</span> unverified
            </LegendDot>
          </div>
          {data.licenceExpiringSoon > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-secondary">
              <ShieldAlert className="h-3 w-3" aria-hidden />
              {data.licenceExpiringSoon} expiring within 30 days
            </div>
          )}
        </>
      )}
    </StatShell>
  );
}

function RiskCard({ data, total, loading }: { data?: { low: number; medium: number; high: number }; total: number; loading?: boolean }) {
  const slices = [
    { name: "Low", value: data?.low ?? 0, color: "hsl(var(--staff-accent))" },
    { name: "Medium", value: data?.medium ?? 0, color: "hsl(var(--secondary))" },
    { name: "High", value: data?.high ?? 0, color: "hsl(var(--destructive))" },
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  const highShare = sum > 0 ? Math.round(((data?.high ?? 0) / sum) * 100) : 0;
  return (
    <StatShell title="Risk distribution" icon={<Activity className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No ratings</div>
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
              <span className="font-display text-sm font-semibold leading-none tabular-nums">{total.toLocaleString()}</span>
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
            {highShare >= 10 && (
              <div className="pt-0.5 text-[10px] font-medium text-destructive">
                {highShare}% flagged high-risk
              </div>
            )}
          </div>
        </div>
      )}
    </StatShell>
  );
}

function PipelineCard({ data, loading }: { data?: CustomerStatsData; loading?: boolean }) {
  return (
    <StatShell title="Pipeline" icon={<Clock className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="Pending hire"
            value={data.pendingHire}
            total={data.total}
            colorVar="--accent"
            hint="booked, not yet returned"
          />
          <PipelineRow
            label="Active rental"
            value={data.activeRental}
            total={data.total}
            colorVar="--staff-accent"
            hint="vehicle currently out"
          />
        </div>
      )}
    </StatShell>
  );
}
