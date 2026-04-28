"use client";

import { Lock, ShieldAlert, ShieldX, KeyRound } from "lucide-react";
import {
  LegendDot,
  LoadingBlock,
  MiniStackedBar,
  PipelineRow,
  StatShell,
} from "@/components/ui/stat-shell";

export interface AuditLogSecurityStatsData {
  range: "24h" | "7d" | "14d" | "30d" | "90d";
  lockouts: number;
  rateLimitTrips: number;
  failedAuth: number;
  badPassword: number;
  denied: number;
  successfulLogins: number;
  topIps: { ip: string; count: number }[];
  topActions: { action: string; count: number }[];
}

const RANGE_LABEL: Record<AuditLogSecurityStatsData["range"], string> = {
  "24h": "last 24h",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
};

export function AuditLogSecurityStats({
  data,
  loading,
}: {
  data?: AuditLogSecurityStatsData;
  loading?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <LockoutsCard data={data} loading={loading} />
      <RateLimitCard data={data} loading={loading} />
      <AuthBreakdownCard data={data} loading={loading} />
      <DeniedCard data={data} loading={loading} />
    </div>
  );
}

function LockoutsCard({ data, loading }: { data?: AuditLogSecurityStatsData; loading?: boolean }) {
  return (
    <StatShell title="Account lockouts" icon={<Lock className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-28" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.lockouts.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {RANGE_LABEL[data.range]} · 5 failed attempts = 30 min lock
          </div>
        </>
      )}
    </StatShell>
  );
}

function RateLimitCard({ data, loading }: { data?: AuditLogSecurityStatsData; loading?: boolean }) {
  return (
    <StatShell title="Rate-limit trips" icon={<ShieldAlert className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-28" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.rateLimitTrips.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {RANGE_LABEL[data.range]} · includes auth, booking, gift-card, support
          </div>
        </>
      )}
    </StatShell>
  );
}

function AuthBreakdownCard({
  data,
  loading,
}: {
  data?: AuditLogSecurityStatsData;
  loading?: boolean;
}) {
  const success = data?.successfulLogins ?? 0;
  const fail = data?.failedAuth ?? 0;
  return (
    <StatShell title="Login attempts" icon={<KeyRound className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: success, colorVar: "--admin-accent" },
              { value: fail, colorVar: "--destructive" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">
              <span className="tabular-nums text-foreground">{success}</span> success
            </LegendDot>
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{fail}</span> failed
            </LegendDot>
            <span className="tabular-nums">· {data.badPassword} bad-pwd</span>
          </div>
        </>
      )}
    </StatShell>
  );
}

function DeniedCard({ data, loading }: { data?: AuditLogSecurityStatsData; loading?: boolean }) {
  const total = Math.max(1, (data?.denied ?? 0) + (data?.rateLimitTrips ?? 0) + (data?.lockouts ?? 0));
  return (
    <StatShell title="System rejections" icon={<ShieldX className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow label="Denied" value={data.denied} total={total} colorVar="--destructive" />
          <PipelineRow
            label="Rate-limited"
            value={data.rateLimitTrips}
            total={total}
            colorVar="--secondary"
          />
          <PipelineRow
            label="Locked out"
            value={data.lockouts}
            total={total}
            colorVar="--admin-accent"
          />
        </div>
      )}
    </StatShell>
  );
}
