"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AcquisitionConversionPayload } from "@/server/services/insights/types";

interface Props {
  payload: AcquisitionConversionPayload;
  height?: number;
}

/**
 * Per-source conversion visual: total sessions split into converted vs
 * unconverted. Reads naturally as "how much traffic, how much closes".
 */
export function StackedConversion({ payload, height = 260 }: Props) {
  if (payload.sources.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-caption text-muted-foreground">
        No visitor data yet.
      </div>
    );
  }

  const data = payload.sources
    .slice(0, 8)
    .map((s) => ({
      source: s.source,
      Converted: s.bookings,
      Unconverted: Math.max(0, s.sessions - s.bookings),
      rate: s.conversionRate,
    }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 24, left: 4, bottom: 4 }}
        >
          <CartesianGrid
            stroke="hsl(var(--border))"
            strokeDasharray="3 3"
            opacity={0.5}
            horizontal={false}
          />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            dataKey="source"
            type="category"
            width={90}
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
            formatter={(v, name, item) => {
              const value = Number(v ?? 0);
              const label = String(name ?? "");
              if (label === "Converted") {
                const rate =
                  (item as { payload?: { rate?: number } })?.payload?.rate ?? 0;
                return [
                  `${value.toLocaleString("en-AU")} (${rate.toFixed(2)}%)`,
                  label,
                ];
              }
              return [value.toLocaleString("en-AU"), label];
            }}
          />
          <Legend
            verticalAlign="top"
            height={20}
            wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
          />
          <Bar
            dataKey="Converted"
            stackId="a"
            fill="hsl(var(--insights-accent))"
            radius={[4, 0, 0, 4]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="Unconverted"
            stackId="a"
            fill="hsl(var(--muted-foreground) / 0.3)"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
