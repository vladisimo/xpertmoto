"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface RevenueTrendPoint {
  /** "YYYY-MM" key. */
  key: string;
  /** Short month label, e.g. "Jun" (with year suffix on January for clarity). */
  label: string;
  revenue: number;
  bookings: number;
}

/**
 * Booking-based revenue per month for the last 12 months. The most recent
 * month is highlighted in the admin accent; prior months recede so the current
 * trajectory reads first.
 */
export function AdminRevenueTrendChartClient({ data }: { data: RevenueTrendPoint[] }) {
  const lastIndex = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 280 }}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
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
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            fontSize: 12,
            borderRadius: 6,
          }}
          labelFormatter={(label, payload) => {
            const p = payload?.[0]?.payload as RevenueTrendPoint | undefined;
            return p ? `${label} · ${p.bookings} booking${p.bookings === 1 ? "" : "s"}` : label;
          }}
          formatter={(v) => [
            `$${Number(v ?? 0).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`,
            "Revenue",
          ]}
        />
        <Bar dataKey="revenue" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell
              key={d.key}
              fill={
                i === lastIndex
                  ? "hsl(var(--admin-accent))"
                  : "hsl(var(--admin-accent) / 0.45)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
