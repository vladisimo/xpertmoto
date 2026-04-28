"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { ShieldCheck, Users, UserCog, UserPlus } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface UsersStatsData {
  total: number;
  byRole: { customer: number; staff: number; manager: number; admin: number; superAdmin: number };
  byStatus: { active: number; suspended: number; banned: number };
  newThisMonth: number;
  staffPendingVerification: number;
}

export function UsersStats({ data, loading }: { data?: UsersStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <TotalCard data={data} loading={loading} />
      <RoleCard data={data?.byRole} loading={loading} />
      <StatusCard data={data?.byStatus} loading={loading} />
      <PipelineCard data={data} loading={loading} />
    </div>
  );
}

function TotalCard({ data, loading }: { data?: UsersStatsData; loading?: boolean }) {
  return (
    <StatShell title="Total users" icon={<Users className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-24" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.total.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.newThisMonth} new this month
          </div>
        </>
      )}
    </StatShell>
  );
}

function RoleCard({ data, loading }: { data?: UsersStatsData["byRole"]; loading?: boolean }) {
  return (
    <StatShell title="Role distribution" icon={<UserCog className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.customer, colorVar: "--admin-accent" },
              { value: data.staff, colorVar: "--staff-accent" },
              { value: data.manager, colorVar: "--accent" },
              { value: data.admin, colorVar: "--secondary" },
              { value: data.superAdmin, colorVar: "--destructive" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">
              <span className="tabular-nums text-foreground">{data.customer}</span> customers
            </LegendDot>
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{data.staff}</span> staff
            </LegendDot>
            <LegendDot colorVar="--accent">
              <span className="tabular-nums text-foreground">{data.manager}</span> mgr
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{data.admin}</span> admin
            </LegendDot>
            {data.superAdmin > 0 && (
              <LegendDot colorVar="--destructive">
                <span className="tabular-nums text-foreground">{data.superAdmin}</span> super
              </LegendDot>
            )}
          </div>
        </>
      )}
    </StatShell>
  );
}

function StatusCard({
  data,
  loading,
}: {
  data?: UsersStatsData["byStatus"];
  loading?: boolean;
}) {
  const slices = [
    { name: "Active", value: data?.active ?? 0, color: "hsl(var(--admin-accent))" },
    { name: "Suspended", value: data?.suspended ?? 0, color: "hsl(var(--secondary))" },
    { name: "Banned", value: data?.banned ?? 0, color: "hsl(var(--destructive))" },
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  const activeShare = sum > 0 ? Math.round(((data?.active ?? 0) / sum) * 100) : 0;
  return (
    <StatShell title="Account status" icon={<ShieldCheck className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No users yet</div>
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
              <span className="font-display text-sm font-semibold leading-none tabular-nums">{activeShare}%</span>
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

function PipelineCard({ data, loading }: { data?: UsersStatsData; loading?: boolean }) {
  return (
    <StatShell title="Growth & verification" icon={<UserPlus className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="New this month"
            value={data.newThisMonth}
            total={Math.max(1, data.total)}
            colorVar="--admin-accent"
          />
          <PipelineRow
            label="Staff pending verification"
            value={data.staffPendingVerification}
            total={Math.max(1, data.byRole.staff + data.byRole.manager + data.byRole.admin)}
            colorVar="--secondary"
            hint="emailVerified null"
          />
        </div>
      )}
    </StatShell>
  );
}
