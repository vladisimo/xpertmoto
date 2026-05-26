"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  fontSize: 12,
  borderRadius: 6,
} as const;

const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
const currency = (n: number) =>
  `$${Number(n ?? 0).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;

/** Forward billing forecast — expected recurring income, bucketed per day. */
export function RecurringForecastChart({
  data,
}: {
  data: Array<{ date: string; amount: number; count: number }>;
}) {
  const chartData = data.map((d) => {
    const dt = new Date(d.date + "T00:00:00Z");
    return {
      ...d,
      label: dt.toLocaleDateString("en-AU", { day: "numeric", timeZone: "UTC" }),
      weekday: dt.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" }),
    };
  });
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 256 }}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.5} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)}
          width={48}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
          labelFormatter={(_label, payload) => {
            const p = payload?.[0]?.payload as { weekday?: string; date?: string } | undefined;
            return p ? `${p.weekday} ${p.date}` : "";
          }}
          formatter={(v, _n, item) => {
            const count = (item?.payload as { count?: number } | undefined)?.count ?? 0;
            return [`${currency(Number(v))} · ${count} charge${count === 1 ? "" : "s"}`, "Expected"];
          }}
        />
        <Bar dataKey="amount" fill="hsl(var(--admin-accent))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Trailing collected recurring revenue, by month. */
export function RecurringTrendChart({ data }: { data: Array<{ label: string; amount: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 192 }}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
        <defs>
          <linearGradient id="recurring-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--admin-accent))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--admin-accent))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.5} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`)}
          width={48}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [currency(Number(v)), "Collected"]} />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="hsl(var(--admin-accent))"
          strokeWidth={2.5}
          fill="url(#recurring-trend-fill)"
          dot={{ r: 2.5, strokeWidth: 0, fill: "hsl(var(--admin-accent))" }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Plans-by-status donut. Center shows the total plan count. */
export function RecurringStatusDonut({ data }: { data: Array<{ name: string; value: number; colorVar: string }> }) {
  const slices = data.filter((d) => d.value > 0);
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="relative h-28 w-28">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 112, height: 112 }}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            innerRadius={36}
            outerRadius={54}
            paddingAngle={slices.length > 1 ? 2 : 0}
            stroke="none"
            isAnimationActive={false}
          >
            {slices.map((s) => (
              <Cell key={s.name} fill={`hsl(var(${s.colorVar}))`} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-xl font-semibold tabular-nums text-foreground">{total}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">plans</span>
      </div>
    </div>
  );
}
