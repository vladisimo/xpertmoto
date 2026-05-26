"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
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

// Oldest → newest reading order; error sits on top in warning red so spikes
// read first, the rest recede through the accent/neutral ramp.
const SERIES = [
  { key: "transaction", label: "Transactions", color: "hsl(var(--admin-accent))" },
  { key: "replay", label: "Replays", color: "hsl(var(--admin-accent) / 0.5)" },
  { key: "attachment", label: "Attachments", color: "hsl(var(--muted-foreground) / 0.5)" },
  { key: "error", label: "Errors", color: "hsl(var(--destructive))" },
] as const;

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("en-AU", { maximumFractionDigits: 1 })}k` : String(n);

export type ObservabilityTrendPoint = {
  date: string;
  total: number;
  error: number;
  transaction: number;
  replay: number;
  attachment: number;
  costAud: number;
};

export function ObservabilityTrend({
  data,
  height = 260,
}: {
  data: ObservabilityTrendPoint[];
  height?: number;
}) {
  const chartData = data.map((d) => ({
    ...d,
    label: new Date(d.date + "T00:00:00Z").toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
  }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`obs-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.5} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(n: number) => compact(n)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ stroke: "hsl(var(--border))" }}
            formatter={(v, name) => [Number(v ?? 0).toLocaleString("en-AU"), name]}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
          />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId="events"
              stroke={s.color}
              strokeWidth={1.5}
              fill={`url(#obs-${s.key})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
