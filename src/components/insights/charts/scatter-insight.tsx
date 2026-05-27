"use client";

import * as React from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  ReferenceLine,
  Cell,
} from "recharts";
import type { MaintenanceVsRevenuePayload } from "@/server/services/insights/types";

interface Props {
  payload: MaintenanceVsRevenuePayload;
  height?: number;
}

/**
 * Revenue vs maintenance scatter. Each dot = one vehicle. Dots below the
 * diagonal are loss-makers (maintenance cost > revenue) and render in
 * destructive red; others render in staff accent.
 */
export function ScatterInsight({ payload, height = 280 }: Props) {
  if (payload.points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-caption text-muted-foreground">
        No vehicle data yet.
      </div>
    );
  }

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 16 }}>
          <CartesianGrid
            stroke="hsl(var(--border))"
            strokeDasharray="3 3"
            opacity={0.5}
          />
          <XAxis
            type="number"
            dataKey="revenue"
            name="Revenue"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(n: number) =>
              `$${Math.round(n / 1000)}k`
            }
            label={{
              value: "Revenue (AUD, 12m)",
              position: "insideBottom",
              offset: -4,
              fontSize: 11,
              fill: "hsl(var(--muted-foreground))",
            }}
          />
          <YAxis
            type="number"
            dataKey="maintenanceCost"
            name="Maintenance"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(n: number) => `$${Math.round(n / 1000)}k`}
            label={{
              value: "Maintenance (AUD)",
              angle: -90,
              position: "insideLeft",
              offset: 8,
              fontSize: 11,
              fill: "hsl(var(--muted-foreground))",
            }}
          />
          <ZAxis range={[50, 160]} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: payload.medianRevenue * 3, y: payload.medianRevenue * 3 },
            ]}
            stroke="hsl(var(--muted-foreground) / 0.5)"
            strokeDasharray="3 3"
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              fontSize: 12,
              borderRadius: 6,
            }}
            formatter={(v, _n, item) => {
              const label =
                (item as { payload?: { label?: string } })?.payload?.label ??
                "Vehicle";
              return [
                `$${Math.round(Number(v ?? 0)).toLocaleString("en-AU")}`,
                label,
              ];
            }}
          />
          <Scatter data={payload.points} isAnimationActive={false}>
            {payload.points.map((p, i) => (
              <Cell
                key={i}
                fill={
                  p.lossMaker
                    ? "hsl(var(--destructive))"
                    : "hsl(var(--insights-accent))"
                }
                fillOpacity={0.85}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
