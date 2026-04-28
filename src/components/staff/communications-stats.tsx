"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { AlertTriangle, MessageSquare, Send, Radio } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface CommunicationsStatsData {
  sentInRange: number;
  deliveryRate: number;
  byStatus: { sent: number; delivered: number; bounced: number; failed: number };
  byChannel: { email: number; sms: number; inApp: number; push: number };
  failedToday: number;
  bouncedToday: number;
  openedCount: number;
}

export function CommunicationsStats({ data, loading }: { data?: CommunicationsStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <VolumeCard data={data} loading={loading} />
      <ChannelCard data={data?.byChannel} loading={loading} />
      <DeliveryCard data={data} loading={loading} />
      <FailureCard data={data} loading={loading} />
    </div>
  );
}

function VolumeCard({ data, loading }: { data?: CommunicationsStatsData; loading?: boolean }) {
  return (
    <StatShell title="Sent in range" icon={<Send className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-24" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {data.sentInRange.toLocaleString("en-AU")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.byStatus.delivered} delivered · {data.openedCount} opened
          </div>
        </>
      )}
    </StatShell>
  );
}

function ChannelCard({
  data,
  loading,
}: {
  data?: CommunicationsStatsData["byChannel"];
  loading?: boolean;
}) {
  return (
    <StatShell title="Channel split" icon={<Radio className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.email, colorVar: "--staff-accent" },
              { value: data.sms, colorVar: "--accent" },
              { value: data.inApp, colorVar: "--secondary" },
              { value: data.push, colorVar: "--primary" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--staff-accent">
              <span className="tabular-nums text-foreground">{data.email}</span> email
            </LegendDot>
            <LegendDot colorVar="--accent">
              <span className="tabular-nums text-foreground">{data.sms}</span> sms
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{data.inApp}</span> in-app
            </LegendDot>
            <LegendDot colorVar="--primary">
              <span className="tabular-nums text-foreground">{data.push}</span> push
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function DeliveryCard({ data, loading }: { data?: CommunicationsStatsData; loading?: boolean }) {
  const slices = [
    { name: "Delivered", value: data?.byStatus.delivered ?? 0, color: "hsl(var(--staff-accent))" },
    { name: "Sent", value: data?.byStatus.sent ?? 0, color: "hsl(var(--accent))" },
    { name: "Bounced", value: data?.byStatus.bounced ?? 0, color: "hsl(var(--secondary))" },
    { name: "Failed", value: data?.byStatus.failed ?? 0, color: "hsl(var(--destructive))" },
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  const rate = data?.deliveryRate ?? 0;
  return (
    <StatShell title="Delivery health" icon={<MessageSquare className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No messages yet</div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            <PieChart width={64} height={64}>
              <Pie data={slices} dataKey="value" innerRadius={20} outerRadius={32} paddingAngle={2} stroke="none" isAnimationActive={false}>
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-sm font-semibold leading-none tabular-nums">
                {Math.round(rate * 100)}%
              </span>
            </div>
          </div>
          <div className="min-w-0 space-y-1 text-[11px]">
            {slices.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
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

function FailureCard({ data, loading }: { data?: CommunicationsStatsData; loading?: boolean }) {
  return (
    <StatShell title="Failures today" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="Failed"
            value={data.failedToday}
            total={Math.max(1, data.sentInRange)}
            colorVar="--destructive"
            hint="permanent send failures"
          />
          <PipelineRow
            label="Bounced"
            value={data.bouncedToday}
            total={Math.max(1, data.sentInRange)}
            colorVar="--secondary"
            hint="hard/soft bounces"
          />
        </div>
      )}
    </StatShell>
  );
}
