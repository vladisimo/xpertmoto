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
import type { RevenueTrendPayload } from "@/server/services/insights/types";

interface Props {
  payload: RevenueTrendPayload;
  height?: number;
}

export function TrendOverlay({ payload, height = 260 }: Props) {
  if (payload.months.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-caption text-muted-foreground">
        No revenue data yet.
      </div>
    );
  }

  const data = payload.months.map((m) => ({
    label: m.month.slice(2).replace("-", "/"),
    current: m.currentRevenue,
    prior: m.priorYearRevenue,
  }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 12, left: 12 }}
        >
          <CartesianGrid
            stroke="hsl(var(--border))"
            strokeDasharray="3 3"
            opacity={0.5}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(n: number) =>
              n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`
            }
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
          <Line
            type="monotone"
            dataKey="prior"
            name="Prior year"
            stroke="hsl(var(--insights-accent-soft) / 0.6)"
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 4"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="current"
            name="This year"
            stroke="hsl(var(--insights-accent))"
            strokeWidth={2.5}
            dot={{ r: 3, strokeWidth: 0, fill: "hsl(var(--insights-accent))" }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
