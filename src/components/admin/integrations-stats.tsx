"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { Plug, Activity, Send, Radio } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

type IntegrationSpec = {
  key: string;
  label: string;
  level: "configured" | "partial" | "unconfigured";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeIntegrationsLevels(overview: any): IntegrationSpec[] {
  const specs: IntegrationSpec[] = [];
  const pair = (key: string, label: string, configured: boolean, extra?: boolean) =>
    specs.push({
      key,
      label,
      level: configured && extra !== false ? "configured" : configured ? "partial" : "unconfigured",
    });

  pair("stripe", "Stripe", overview.stripe.configured, overview.stripe.webhookConfigured);
  pair("twilio", "Twilio", overview.twilio.configured, overview.twilio.statusCallbackConfigured);
  pair("resend", "Resend", overview.resend.configured, overview.resend.webhookConfigured);
  pair("xero", "Xero", overview.xero.configured, overview.xero.connected);
  pair("etoll", "E-Toll", overview.etoll.configured);
  pair("linkt", "Linkt", overview.linkt.configured);
  pair("push", "Web Push", overview.push.vapidConfigured, overview.push.browserKeyConfigured);
  pair("telemetry", "Telemetry", overview.telemetry.ingestConfigured);
  pair("posthog", "PostHog", overview.posthog.configured, overview.posthog.browserConfigured);
  pair("weather", "Weather", overview.weather.configured);
  pair("regoCheck", "Rego check", overview.regoCheck.configured);
  pair("calendar", "Calendar", overview.calendar.configured);
  return specs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function IntegrationsStats({ overview, loading }: { overview?: any; loading?: boolean }) {
  const specs = overview ? computeIntegrationsLevels(overview) : [];
  const configured = specs.filter((s) => s.level === "configured").length;
  const partial = specs.filter((s) => s.level === "partial").length;
  const unconfigured = specs.filter((s) => s.level === "unconfigured").length;
  const total = specs.length;
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <ConfiguredCard configured={configured} total={total} overview={overview} loading={loading} />
      <HealthCard configured={configured} partial={partial} unconfigured={unconfigured} loading={loading} />
      <NotificationsCard overview={overview} loading={loading} />
      <LiveSignalsCard overview={overview} loading={loading} />
    </div>
  );
}

function ConfiguredCard({
  configured,
  total,
  overview,
  loading,
}: {
  configured: number;
  total: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overview?: any;
  loading?: boolean;
}) {
  const lastSync = overview?.etoll?.lastSyncAt ? new Date(overview.etoll.lastSyncAt) : null;
  return (
    <StatShell title="Integrations configured" icon={<Plug className="h-4 w-4" aria-hidden />}>
      {loading || !overview ? (
        <LoadingBlock className="h-10 w-28" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {configured} <span className="text-base text-muted-foreground">of {total}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {lastSync
              ? `E-toll last sync ${lastSync.toLocaleString("en-AU")}`
              : "E-toll not synced yet"}
          </div>
        </>
      )}
    </StatShell>
  );
}

function HealthCard({
  configured,
  partial,
  unconfigured,
  loading,
}: {
  configured: number;
  partial: number;
  unconfigured: number;
  loading?: boolean;
}) {
  return (
    <StatShell title="Configuration health" icon={<Activity className="h-4 w-4" aria-hidden />}>
      {loading ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: configured, colorVar: "--admin-accent" },
              { value: partial, colorVar: "--secondary" },
              { value: unconfigured, colorVar: "--muted-foreground", opacity: 0.35 },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">
              <span className="tabular-nums text-foreground">{configured}</span> configured
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{partial}</span> partial
            </LegendDot>
            <LegendDot colorVar="--muted-foreground" opacity={0.35}>
              <span className="tabular-nums text-foreground">{unconfigured}</span> off
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NotificationsCard({ overview, loading }: { overview?: any; loading?: boolean }) {
  const sent = overview?.notifications?.sentLast7d ?? 0;
  const delivered = overview?.notifications?.deliveredLast7d ?? 0;
  const failed = overview?.notifications?.failedLast7d ?? 0;
  const slices = [
    { name: "Delivered", value: delivered, color: "hsl(var(--admin-accent))" },
    { name: "Sent", value: sent, color: "hsl(var(--accent))" },
    { name: "Failed", value: failed, color: "hsl(var(--destructive))" },
  ];
  const sum = slices.reduce((a, b) => a + b.value, 0);
  const rate = sum > 0 ? Math.round((delivered / sum) * 100) : 0;
  return (
    <StatShell title="Notifications (7d)" icon={<Send className="h-4 w-4" aria-hidden />}>
      {loading || !overview ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No sends yet</div>
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
              <span className="font-display text-sm font-semibold leading-none tabular-nums">{rate}%</span>
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LiveSignalsCard({ overview, loading }: { overview?: any; loading?: boolean }) {
  const pings = overview?.telemetry?.pingsLast24h ?? 0;
  const devices = overview?.telemetry?.activeDevicesLast7d ?? 0;
  const subs = overview?.push?.subscriptionCount ?? 0;
  const pushDelivered = overview?.push?.deliveredLast24h ?? 0;
  return (
    <StatShell title="Live signals" icon={<Radio className="h-4 w-4" aria-hidden />}>
      {loading || !overview ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <div className="space-y-2.5">
          <PipelineRow
            label="Telemetry devices"
            value={devices}
            total={Math.max(1, devices)}
            colorVar="--admin-accent"
            hint={`${pings} pings 24h`}
          />
          <PipelineRow
            label="Push delivered 24h"
            value={pushDelivered}
            total={Math.max(1, subs)}
            colorVar="--accent"
            hint={`${subs} subs`}
          />
        </div>
      )}
    </StatShell>
  );
}
