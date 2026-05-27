"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type AuditActivityRange = "24h" | "7d" | "14d" | "30d" | "90d";
export type AuditActivityBucket = "hour" | "day" | "week";

export const AUDIT_ACTIVITY_RANGES: { value: AuditActivityRange; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

export interface AuditActivityPoint {
  bucket: Date | string;
  success: number;
  failure: number;
  denied: number;
}

export interface AuditActivityChartProps {
  points: AuditActivityPoint[];
  bucket: AuditActivityBucket;
  loading?: boolean;
}

function formatLabel(d: Date, bucket: AuditActivityBucket): string {
  if (bucket === "hour") {
    return d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

export function AuditActivityChart({ points, bucket, loading }: AuditActivityChartProps) {
  const data = React.useMemo(
    () =>
      points.map((p) => {
        const d = typeof p.bucket === "string" ? new Date(p.bucket) : p.bucket;
        return {
          label: formatLabel(d, bucket),
          iso: d.toISOString(),
          success: p.success,
          failure: p.failure,
          denied: p.denied,
          total: p.success + p.failure + p.denied,
        };
      }),
    [points, bucket],
  );

  const totals = React.useMemo(
    () =>
      data.reduce(
        (acc, d) => {
          acc.success += d.success;
          acc.failure += d.failure;
          acc.denied += d.denied;
          return acc;
        },
        { success: 0, failure: 0, denied: 0 },
      ),
    [data],
  );
  const grandTotal = totals.success + totals.failure + totals.denied;

  // Keep tick count under ~14 regardless of bucket size.
  const tickInterval = Math.max(0, Math.floor(data.length / 14) - 1);

  return (
    <section className="rounded-lg border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="h3">Website activity</h2>
          <p className="text-caption text-muted-foreground">
            Audit events per {bucket} · stacked by outcome
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <Legend colorVar="--admin-accent">
            <span className="tabular-nums text-foreground">
              {totals.success.toLocaleString("en-AU")}
            </span>{" "}
            success
          </Legend>
          <Legend colorVar="--destructive">
            <span className="tabular-nums text-foreground">
              {totals.failure.toLocaleString("en-AU")}
            </span>{" "}
            failure
          </Legend>
          <Legend colorVar="--secondary">
            <span className="tabular-nums text-foreground">
              {totals.denied.toLocaleString("en-AU")}
            </span>{" "}
            denied
          </Legend>
        </div>
      </header>

      <div className="h-56 w-full px-2 py-3">
        {loading ? (
          <div className="h-full w-full animate-pulse rounded bg-muted" aria-hidden />
        ) : grandTotal === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No activity recorded in this window.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 224 }}>
            <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid
                vertical={false}
                stroke="hsl(var(--border))"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Bar
                dataKey="success"
                stackId="a"
                fill="hsl(var(--admin-accent))"
                name="Success"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="failure"
                stackId="a"
                fill="hsl(var(--destructive))"
                name="Failure"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="denied"
                stackId="a"
                fill="hsl(var(--secondary))"
                name="Denied"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function Legend({
  colorVar,
  children,
}: {
  colorVar: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: `hsl(var(${colorVar}))` }}
      />
      {children}
    </span>
  );
}
