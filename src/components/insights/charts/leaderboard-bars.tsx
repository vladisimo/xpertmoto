"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";

export interface LeaderboardDatum {
  label: string;
  value: number;
}

interface Props {
  data: LeaderboardDatum[];
  average?: number;
  averageLabel?: string;
  variant?: "top" | "bottom";
  formatValue?: (n: number) => string;
  className?: string;
  height?: number;
}

export function LeaderboardBars({
  data,
  average,
  averageLabel = "Fleet avg",
  variant = "top",
  formatValue = (n) => `$${Math.round(n).toLocaleString("en-AU")}`,
  className,
  height = 240,
}: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-caption text-muted-foreground">
        No data yet.
      </div>
    );
  }

  const accent =
    variant === "top" ? "hsl(var(--insights-accent))" : "hsl(var(--destructive))";
  const faded = "hsl(var(--muted-foreground) / 0.35)";

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={formatValue}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={80}
            tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              fontSize: 12,
              borderRadius: 6,
            }}
            formatter={(v) => [formatValue(Number(v ?? 0)), "Revenue/day"]}
          />
          {typeof average === "number" && (
            <ReferenceLine
              x={average}
              stroke="hsl(var(--muted-foreground) / 0.6)"
              strokeDasharray="3 3"
              label={{
                value: averageLabel,
                position: "right",
                fill: "hsl(var(--muted-foreground))",
                fontSize: 10,
              }}
            />
          )}
          <Bar dataKey="value" radius={4} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value >= (average ?? 0) ? accent : faded} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
