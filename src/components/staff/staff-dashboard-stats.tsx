"use client";

import { Pie, PieChart } from "recharts";
import {
  AlertTriangle,
  Bike,
  CalendarClock,
  Clock,
  Wrench,
} from "lucide-react";
import {
  LegendDot,
  MiniStackedBar,
  PipelineRow,
  StatShell,
} from "@/components/ui/stat-shell";

export interface StaffDashboardStatsData {
  pickups: number;
  returns: number;
  active: number;
  overdue: {
    total: number;
    due: number;
    noticeSent: number;
    escalated: number;
    over24h: number;
  };
  fleet: {
    total: number;
    needsAttention: number;
    calendarMistakes: number;
    tyreAlerts: number;
  };
}

export function StaffDashboardStats({ data }: { data: StaffDashboardStatsData }) {
  return (
    <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MovementsCard pickups={data.pickups} returns={data.returns} />
      <OnTheRoadCard active={data.active} overdue={data.overdue.total} />
      <EscalationCard overdue={data.overdue} />
      <FleetCard fleet={data.fleet} />
    </div>
  );
}

function MovementsCard({ pickups, returns }: { pickups: number; returns: number }) {
  return (
    <StatShell
      title="Today's movements"
      icon={<CalendarClock className="h-4 w-4" aria-hidden />}
    >
      <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
        {pickups + returns}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <LegendDot colorVar="--staff-accent">
          <span className="tabular-nums text-foreground">{pickups}</span> pickups
        </LegendDot>
        <LegendDot colorVar="--primary">
          <span className="tabular-nums text-foreground">{returns}</span> returns
        </LegendDot>
      </div>
    </StatShell>
  );
}

function OnTheRoadCard({ active, overdue }: { active: number; overdue: number }) {
  const onTime = Math.max(0, active - overdue);
  return (
    <StatShell title="On the road" icon={<Bike className="h-4 w-4" aria-hidden />}>
      {active === 0 && overdue === 0 ? (
        <div className="flex h-10 items-center text-sm text-muted-foreground">
          Nothing on hire right now
        </div>
      ) : (
        <>
          <MiniStackedBar
            height="h-5"
            segments={[
              { value: onTime, colorVar: "--staff-accent" },
              { value: overdue, colorVar: "--destructive" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{onTime}</span> on time
            </LegendDot>
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{overdue}</span> overdue
            </LegendDot>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{active}</span>{" "}
            active hires
          </div>
        </>
      )}
    </StatShell>
  );
}

function EscalationCard({
  overdue,
}: {
  overdue: StaffDashboardStatsData["overdue"];
}) {
  const slices = [
    { name: "Due", value: overdue.due, fill: "hsl(var(--muted-foreground) / 0.35)" },
    { name: "Notice sent", value: overdue.noticeSent, fill: "hsl(var(--secondary))" },
    { name: "Escalated", value: overdue.escalated, fill: "hsl(var(--destructive))" },
  ];
  return (
    <StatShell
      title="Overdue escalation"
      icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
    >
      {overdue.total === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          No overdue returns
        </div>
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
              />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="font-display text-sm font-semibold leading-none tabular-nums">
                {overdue.total}
              </span>
            </div>
          </div>
          <div className="min-w-0 space-y-1 text-[11px]">
            {slices.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.fill }}
                  aria-hidden
                />
                <span className="tabular-nums text-foreground">{s.value}</span>
                <span className="text-muted-foreground">{s.name}</span>
              </div>
            ))}
            {overdue.over24h > 0 && (
              <div className="flex items-center gap-1 pt-0.5 text-[10px] font-medium text-destructive">
                <Clock className="h-3 w-3" aria-hidden />
                {overdue.over24h} over 24 hours
              </div>
            )}
          </div>
        </div>
      )}
    </StatShell>
  );
}

function FleetCard({ fleet }: { fleet: StaffDashboardStatsData["fleet"] }) {
  return (
    <StatShell
      title="Fleet & maintenance"
      icon={<Wrench className="h-4 w-4" aria-hidden />}
    >
      <div className="space-y-2.5">
        <PipelineRow
          label="Needs attention"
          value={fleet.needsAttention}
          total={fleet.total}
          colorVar="--secondary"
          hint="docs & service"
        />
        <PipelineRow
          label="Calendar mistakes"
          value={fleet.calendarMistakes}
          total={fleet.total}
          colorVar="--destructive"
        />
        <PipelineRow
          label="Tyre alerts"
          value={fleet.tyreAlerts}
          total={fleet.total}
          colorVar="--primary"
        />
      </div>
    </StatShell>
  );
}
