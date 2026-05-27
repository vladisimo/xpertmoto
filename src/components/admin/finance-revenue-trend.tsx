"use client";

import * as React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { LoadingBlock } from "@/components/ui/stat-shell";

export interface RevenueTrendData {
  years: number[];
  months: Array<Record<string, number | null>>;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Oldest → newest. The most recent year is the solid accent line; older years
// recede via opacity + dashes so the current trajectory reads first.
const SERIES_STYLES = [
  { stroke: "hsl(var(--muted-foreground) / 0.35)", strokeWidth: 1.5, dash: "4 4" },
  { stroke: "hsl(var(--muted-foreground) / 0.6)", strokeWidth: 1.5, dash: "4 4" },
  { stroke: "hsl(var(--admin-accent) / 0.5)", strokeWidth: 2, dash: undefined },
  { stroke: "hsl(var(--admin-accent))", strokeWidth: 2.5, dash: undefined },
];

export function FinanceRevenueTrend({
  data,
  loading,
  height,
}: {
  data?: RevenueTrendData;
  loading?: boolean;
  /** Fixed pixel height; omit to fill the parent (for no-scroll fill layouts). */
  height?: number;
}) {
  if (loading || !data) {
    return <LoadingBlock className={cn("w-full", height ? "" : "h-full")} />;
  }

  const chartData = data.months.map((m) => ({ ...m, label: MONTH_LABELS[(m.month as number) - 1] }));

  return (
    <div style={height ? { height } : undefined} className={cn("w-full", height ? "" : "h-full")}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: height ?? 280 }}>
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 12, left: 12 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.5} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              fontSize: 12,
              borderRadius: 6,
            }}
            formatter={(v) =>
              `$${Number(v ?? 0).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`
            }
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconType="plainline"
            wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
          />
          {data.years.map((year, i) => {
            // Map each year to a style, anchoring the newest at the end of the array.
            const style = SERIES_STYLES[SERIES_STYLES.length - data.years.length + i] ?? SERIES_STYLES[0]!;
            const isLatest = i === data.years.length - 1;
            return (
              <Line
                key={year}
                type="monotone"
                dataKey={String(year)}
                name={String(year)}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.dash}
                dot={isLatest ? { r: 2.5, strokeWidth: 0, fill: "hsl(var(--admin-accent))" } : false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
