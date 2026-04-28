"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { AlertTriangle, Clock, ListChecks, UserCheck } from "lucide-react";
import type { StaffTaskTier } from "@prisma/client";
import {
  LegendDot,
  LoadingBlock,
  PipelineRow,
  StatShell,
} from "@/components/ui/stat-shell";

export interface TasksStatsInput {
  tasks: Array<{
    tier: StaffTaskTier;
    ageSeconds: number;
    inProgress: { isMine: boolean } | null;
  }>;
}

const TIER_META: Record<
  StaffTaskTier,
  { key: "urgent" | "high" | "medium" | "low"; label: string; colorVar: string; opacity?: number }
> = {
  URGENT: { key: "urgent", label: "Urgent", colorVar: "--destructive" },
  HIGH: { key: "high", label: "High", colorVar: "--secondary" },
  MEDIUM: { key: "medium", label: "Medium", colorVar: "--accent" },
  LOW: { key: "low", label: "Low", colorVar: "--muted-foreground", opacity: 0.5 },
};

export function TasksStats({
  input,
  loading,
}: {
  input?: TasksStatsInput;
  loading?: boolean;
}) {
  const rollup = React.useMemo(() => {
    if (!input) return null;
    const total = input.tasks.length;
    let mine = 0;
    let others = 0;
    const tierCounts = { urgent: 0, high: 0, medium: 0, low: 0 };
    const ageBands = { fresh: 0, recent: 0, stale: 0, critical: 0 };
    for (const t of input.tasks) {
      tierCounts[TIER_META[t.tier].key] += 1;
      if (t.inProgress) {
        if (t.inProgress.isMine) mine += 1;
        else others += 1;
      }
      const ageHours = t.ageSeconds / 3_600;
      if (ageHours < 1) ageBands.fresh += 1;
      else if (ageHours < 4) ageBands.recent += 1;
      else if (ageHours < 24) ageBands.stale += 1;
      else ageBands.critical += 1;
    }
    const inProgress = mine + others;
    const unclaimed = total - inProgress;
    return { total, mine, others, inProgress, unclaimed, tierCounts, ageBands };
  }, [input]);

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <TotalCard rollup={rollup} loading={loading} />
      <TierCard rollup={rollup} loading={loading} />
      <ClaimMixCard rollup={rollup} loading={loading} />
      <QueueAgeCard rollup={rollup} loading={loading} />
    </div>
  );
}

interface Rollup {
  total: number;
  mine: number;
  others: number;
  inProgress: number;
  unclaimed: number;
  tierCounts: { urgent: number; high: number; medium: number; low: number };
  ageBands: { fresh: number; recent: number; stale: number; critical: number };
}

function TotalCard({ rollup, loading }: { rollup: Rollup | null; loading?: boolean }) {
  return (
    <StatShell title="Open tasks" icon={<ListChecks className="h-4 w-4" aria-hidden />}>
      {loading || !rollup ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {rollup.total.toLocaleString("en-AU")}
          </div>
          <div className="mt-2 space-y-2.5">
            <PipelineRow
              label="In progress"
              value={rollup.inProgress}
              total={rollup.total}
              colorVar="--primary"
              hint={rollup.mine > 0 ? `${rollup.mine} yours` : undefined}
            />
            <PipelineRow
              label="Unclaimed"
              value={rollup.unclaimed}
              total={rollup.total}
              colorVar="--muted-foreground"
            />
          </div>
        </>
      )}
    </StatShell>
  );
}

function TierCard({ rollup, loading }: { rollup: Rollup | null; loading?: boolean }) {
  return (
    <StatShell title="By priority" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
      {loading || !rollup ? (
        <LoadingBlock className="h-16 w-full" />
      ) : rollup.total === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          Inbox zero — nothing waiting
        </div>
      ) : (
        <>
          <div className="flex h-5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              style={{
                width: `${(rollup.tierCounts.urgent / rollup.total) * 100}%`,
                backgroundColor: "hsl(var(--destructive))",
              }}
            />
            <div
              style={{
                width: `${(rollup.tierCounts.high / rollup.total) * 100}%`,
                backgroundColor: "hsl(var(--secondary))",
              }}
            />
            <div
              style={{
                width: `${(rollup.tierCounts.medium / rollup.total) * 100}%`,
                backgroundColor: "hsl(var(--accent))",
              }}
            />
            <div
              style={{
                width: `${(rollup.tierCounts.low / rollup.total) * 100}%`,
                backgroundColor: "hsl(var(--muted-foreground) / 0.5)",
              }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{rollup.tierCounts.urgent}</span> urgent
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{rollup.tierCounts.high}</span> high
            </LegendDot>
            <LegendDot colorVar="--accent">
              <span className="tabular-nums text-foreground">{rollup.tierCounts.medium}</span> medium
            </LegendDot>
            <LegendDot colorVar="--muted-foreground" opacity={0.5}>
              <span className="tabular-nums text-foreground">{rollup.tierCounts.low}</span> low
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function ClaimMixCard({ rollup, loading }: { rollup: Rollup | null; loading?: boolean }) {
  const slices = rollup
    ? [
        { name: "Mine", value: rollup.mine, color: "hsl(var(--primary))" },
        { name: "Others'", value: rollup.others, color: "hsl(var(--accent))" },
        {
          name: "Unclaimed",
          value: rollup.unclaimed,
          color: "hsl(var(--muted-foreground) / 0.5)",
        },
      ]
    : [];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  return (
    <StatShell title="Claim mix" icon={<UserCheck className="h-4 w-4" aria-hidden />}>
      {loading || !rollup ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No open tasks</div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            <PieChart width={64} height={64}>
              <Pie
                data={slices}
                dataKey="value"
                innerRadius={20}
                outerRadius={32}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-sm font-semibold leading-none tabular-nums">
                {sum.toLocaleString("en-AU")}
              </span>
            </div>
          </div>
          <div className="min-w-0 space-y-1 text-[11px]">
            {slices.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="tabular-nums text-foreground">{s.value}</span>
                <span className="text-muted-foreground">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </StatShell>
  );
}

function QueueAgeCard({ rollup, loading }: { rollup: Rollup | null; loading?: boolean }) {
  return (
    <StatShell title="Queue age" icon={<Clock className="h-4 w-4" aria-hidden />}>
      {loading || !rollup ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="Fresh"
            hint="<1h"
            value={rollup.ageBands.fresh}
            total={rollup.total}
            colorVar="--staff-accent"
          />
          <PipelineRow
            label="Recent"
            hint="1–4h"
            value={rollup.ageBands.recent}
            total={rollup.total}
            colorVar="--accent"
          />
          <PipelineRow
            label="Stale"
            hint="4–24h"
            value={rollup.ageBands.stale}
            total={rollup.total}
            colorVar="--secondary"
          />
          <PipelineRow
            label="Critical"
            hint=">24h"
            value={rollup.ageBands.critical}
            total={rollup.total}
            colorVar="--destructive"
          />
        </div>
      )}
    </StatShell>
  );
}
