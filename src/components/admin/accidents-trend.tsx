"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface AccidentsTrendPoint {
  month: string;
  minor: number;
  moderate: number;
  major: number;
  totalLoss: number;
}

export function AccidentsTrend({ data }: { data: AccidentsTrendPoint[] }) {
  const chartData = data.map((d) => ({
    month: d.month.slice(5),
    minor: d.minor,
    moderate: d.moderate,
    major: d.major + d.totalLoss,
  }));
  const hasData = chartData.some((d) => d.minor + d.moderate + d.major > 0);

  if (!hasData) {
    return (
      <p className="caption py-6 text-center">
        No incidents recorded in the last 12 months.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
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
            />
            <Bar dataKey="minor" stackId="a" fill="hsl(var(--muted-foreground) / 0.5)" name="Minor" />
            <Bar dataKey="moderate" stackId="a" fill="hsl(var(--secondary))" name="Moderate">
              {chartData.map((_, i) => (
                <Cell key={i} />
              ))}
            </Bar>
            <Bar dataKey="major" stackId="a" fill="hsl(var(--destructive))" name="Major+" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <LegendDot color="hsl(var(--muted-foreground) / 0.5)">Minor</LegendDot>
        <LegendDot color="hsl(var(--secondary))">Moderate</LegendDot>
        <LegendDot color="hsl(var(--destructive))">Major+</LegendDot>
      </div>
    </div>
  );
}

function LegendDot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {children}
    </span>
  );
}
