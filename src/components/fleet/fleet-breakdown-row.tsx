"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { Building2, Layers, PieChart as PieIcon, Sparkles } from "lucide-react";
import { StatShell } from "@/components/ui/stat-shell";

export interface FleetBreakdownData {
  composition: {
    total: number;
    available: number;
    rented: number;
    maintenance: number;
    accidentRepairs: number;
    other: number;
  };
  byDepot: Array<{ id: string; name: string; value: number }>;
  byCategory: Array<{ id: string; name: string; value: number }>;
  byCondition: Array<{ id: string; name: string; value: number }>;
}

export function FleetBreakdownRow({ data }: { data: FleetBreakdownData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <CompositionCard data={data.composition} />
      <BarsListCard
        title="Fleet by depot"
        icon={<Building2 className="h-4 w-4" aria-hidden />}
        items={data.byDepot}
        colorVar="--primary"
      />
      <BarsListCard
        title="Fleet by category"
        icon={<Layers className="h-4 w-4" aria-hidden />}
        items={data.byCategory}
        colorVar="--secondary"
      />
      <BarsListCard
        title="Fleet by condition"
        icon={<Sparkles className="h-4 w-4" aria-hidden />}
        items={data.byCondition}
        colorVar="--staff-accent"
      />
    </div>
  );
}

function CompositionCard({ data }: { data: FleetBreakdownData["composition"] }) {
  const slices = [
    { key: "available",       label: "Available",        value: data.available,       fill: "hsl(var(--staff-accent))" },
    { key: "rented",          label: "Rented",           value: data.rented,          fill: "hsl(var(--accent))" },
    { key: "maintenance",     label: "In maintenance",   value: data.maintenance,     fill: "hsl(var(--secondary))" },
    { key: "accidentRepairs", label: "Accident repairs", value: data.accidentRepairs, fill: "hsl(var(--destructive))" },
    { key: "other",           label: "Other",            value: data.other,           fill: "hsl(var(--muted-foreground) / 0.35)" },
  ].filter((s) => s.value > 0);
  const total = data.total;

  return (
    <StatShell title="Fleet composition" icon={<PieIcon className="h-4 w-4" aria-hidden />}>
      {total === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No vehicles</div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            <PieChart width={64} height={64}>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius={19}
                outerRadius={32}
                paddingAngle={2}
                stroke="hsl(var(--card))"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.fill} />
                ))}
              </Pie>
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-sm font-semibold leading-none tabular-nums">
                {total.toLocaleString()}
              </span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1 text-[11px]">
            {slices.slice(0, 4).map((s) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              return (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.fill }}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
                  <span className="tabular-nums text-muted-foreground">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </StatShell>
  );
}

function BarsListCard({
  title,
  icon,
  items,
  colorVar,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ id: string; name: string; value: number }>;
  colorVar: string;
}) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const visible = items.slice(0, 4);
  const hidden = items.length - visible.length;

  return (
    <StatShell title={title} icon={icon}>
      {items.length === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No data</div>
      ) : (
        <ul className="space-y-2 text-[11px]">
          {visible.map((d) => {
            const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
            return (
              <li key={d.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-foreground">{d.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    <span className="text-foreground">{d.value}</span>
                    <span className="ml-1">·{pct}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: `hsl(var(${colorVar}))` }}
                    aria-hidden
                  />
                </div>
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="pt-1 text-[10px] text-muted-foreground">
              +{hidden} more
            </li>
          )}
        </ul>
      )}
    </StatShell>
  );
}
