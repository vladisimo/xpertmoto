"use client";

import * as React from "react";
import { Activity, CheckCircle2, Clock, Timer } from "lucide-react";
import type { StaffTaskType } from "@prisma/client";
import {
  LegendDot,
  LoadingBlock,
  MiniStackedBar,
  PipelineRow,
  StatShell,
} from "@/components/ui/stat-shell";
import { TASK_TYPE_LABEL } from "@/lib/tasks/tiers";
import { formatDuration } from "@/lib/utils";

export interface HistorySummaryData {
  overall: {
    total: number;
    completed: number;
    abandoned: number;
    superseded: number;
    avgSeconds: number;
    p50Seconds: number;
    p95Seconds: number;
    waitAvgSeconds: number;
    waitP50Seconds: number;
    cycleAvgSeconds: number;
    cycleP50Seconds: number;
    cycleP95Seconds: number;
  };
  byTaskType: Array<{
    taskType: StaffTaskType;
    completed: number;
    total: number;
    avgSeconds: number;
    cycleAvgSeconds: number;
  }>;
  byStaff: Array<{
    staffId: string;
    staffName: string;
    completed: number;
    total: number;
    avgSeconds: number;
    cycleAvgSeconds: number;
  }>;
}

export function HistoryStats({
  data,
  loading,
}: {
  data?: HistorySummaryData;
  loading?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <ClosedCard data={data} loading={loading} />
      <CycleTimeCard data={data} loading={loading} />
      <SlowestTypeCard data={data} loading={loading} />
      <TopStaffCard data={data} loading={loading} />
    </div>
  );
}

function ClosedCard({ data, loading }: { data?: HistorySummaryData; loading?: boolean }) {
  return (
    <StatShell title="Closed in range" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.overall.total.toLocaleString("en-AU")}
          </div>
          <div className="mt-2">
            <MiniStackedBar
              segments={[
                { value: data.overall.completed, colorVar: "--staff-accent" },
                { value: data.overall.abandoned, colorVar: "--secondary" },
                { value: data.overall.superseded, colorVar: "--muted-foreground", opacity: 0.5 },
              ]}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{data.overall.completed}</span>{" "}
              completed
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{data.overall.abandoned}</span>{" "}
              abandoned
            </LegendDot>
            <LegendDot colorVar="--muted-foreground" opacity={0.5}>
              <span className="tabular-nums text-foreground">{data.overall.superseded}</span>{" "}
              superseded
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function CycleTimeCard({ data, loading }: { data?: HistorySummaryData; loading?: boolean }) {
  return (
    <StatShell title="Cycle time" icon={<Timer className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : data.overall.completed === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          No completed tasks
        </div>
      ) : (
        <div className="space-y-2">
          <Row
            label="Work time"
            hint="claim → close"
            p50={data.overall.p50Seconds}
            avg={data.overall.avgSeconds}
            p95={data.overall.p95Seconds}
            colorVar="--primary"
          />
          <Row
            label="Total cycle"
            hint="system → close"
            p50={data.overall.cycleP50Seconds}
            avg={data.overall.cycleAvgSeconds}
            p95={data.overall.cycleP95Seconds}
            colorVar="--accent"
          />
        </div>
      )}
    </StatShell>
  );
}

function Row({
  label,
  hint,
  p50,
  avg,
  p95,
  colorVar,
}: {
  label: string;
  hint: string;
  p50: number;
  avg: number;
  p95: number;
  colorVar: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">
          {label}
          <span className="ml-1 text-muted-foreground/70">· {hint}</span>
        </span>
        <span className="tabular-nums text-foreground">
          p50 <span className="font-medium">{formatDuration(p50)}</span>
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
        <span>
          avg <span className="tabular-nums text-foreground">{formatDuration(avg)}</span>
        </span>
        <span className="text-right">
          p95 <span className="tabular-nums text-foreground">{formatDuration(p95)}</span>
        </span>
      </div>
      <div
        aria-hidden
        className="mt-1 h-1 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: `hsl(var(${colorVar}) / 0.2)` }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, p95 > 0 ? (avg / p95) * 100 : 0)}%`,
            backgroundColor: `hsl(var(${colorVar}))`,
          }}
        />
      </div>
    </div>
  );
}

function SlowestTypeCard({ data, loading }: { data?: HistorySummaryData; loading?: boolean }) {
  const top = React.useMemo(() => {
    if (!data) return [];
    return [...data.byTaskType]
      .filter((r) => r.completed > 0)
      .sort((a, b) => b.cycleAvgSeconds - a.cycleAvgSeconds)
      .slice(0, 5);
  }, [data]);
  const maxCycle = top[0]?.cycleAvgSeconds ?? 0;
  return (
    <StatShell title="Slowest types" icon={<Clock className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : top.length === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          No completed tasks yet
        </div>
      ) : (
        <div className="space-y-2">
          {top.map((r) => (
            <PipelineRow
              key={r.taskType}
              label={TASK_TYPE_LABEL[r.taskType] ?? r.taskType}
              hint={`${r.completed} closed`}
              value={r.cycleAvgSeconds}
              total={maxCycle}
              colorVar="--secondary"
              formatValue={(n) => formatDuration(n)}
            />
          ))}
        </div>
      )}
    </StatShell>
  );
}

function TopStaffCard({ data, loading }: { data?: HistorySummaryData; loading?: boolean }) {
  const top = React.useMemo(() => {
    if (!data) return [];
    return [...data.byStaff]
      .filter((r) => r.completed > 0)
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 5);
  }, [data]);
  const maxCompleted = top[0]?.completed ?? 0;
  return (
    <StatShell title="Top resolvers" icon={<Activity className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : top.length === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          No staff activity yet
        </div>
      ) : (
        <div className="space-y-2">
          {top.map((r) => (
            <PipelineRow
              key={r.staffId}
              label={r.staffName}
              hint={`avg ${formatDuration(r.avgSeconds)}`}
              value={r.completed}
              total={maxCompleted}
              colorVar="--staff-accent"
            />
          ))}
        </div>
      )}
    </StatShell>
  );
}
