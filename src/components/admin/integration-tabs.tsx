"use client";

import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/router";
import { INTEGRATION_SERVICES } from "@/lib/integration-fields";
import { IntegrationConfigEditor } from "@/components/admin/integration-config-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import { IntegrationTabEtoll } from "@/components/staff/integration-tab-etoll";
import {
  CreditCard,
  MessageSquare,
  Mail,
  Receipt,
  ShieldCheck,
  CarFront,
  Calendar,
  Cloud,
  Bell,
  Satellite,
  BarChart,
  CheckCircle2,
  AlertCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

type StatusLevel = "ok" | "partial" | "off";

type Overview = inferRouterOutputs<AppRouter>["admin"]["integrationsOverview"];

function StatusDot({ level }: { level: StatusLevel }) {
  if (level === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (level === "partial") return <AlertCircle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-muted-foreground" />;
}

function IntegrationCard({
  icon: Icon,
  title,
  subtitle,
  level,
  children,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  level: StatusLevel;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-2">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {title}
              <StatusDot level={level} />
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </CardHeader>
      {children && <CardContent className="pt-0 space-y-2 text-sm">{children}</CardContent>}
    </Card>
  );
}

function KV({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : "font-medium"}>{value}</span>
    </div>
  );
}

function stripeLevel(o: Overview): StatusLevel {
  return o.stripe.configured ? (o.stripe.webhookConfigured ? "ok" : "partial") : "off";
}
function twilioLevel(o: Overview): StatusLevel {
  return o.twilio.configured ? (o.twilio.statusCallbackConfigured ? "ok" : "partial") : "off";
}
function resendLevel(o: Overview): StatusLevel {
  return o.resend.configured ? (o.resend.webhookConfigured ? "ok" : "partial") : "off";
}
function xeroLevel(o: Overview): StatusLevel {
  return !o.xero.configured ? "off" : o.xero.connected ? "ok" : "partial";
}
function pushLevel(o: Overview): StatusLevel {
  return o.push.vapidConfigured ? (o.push.browserKeyConfigured ? "ok" : "partial") : "off";
}
function telemetryLevel(o: Overview): StatusLevel {
  return o.telemetry.ingestConfigured ? "ok" : "off";
}
function posthogLevel(o: Overview): StatusLevel {
  return o.posthog.configured ? (o.posthog.browserConfigured ? "ok" : "partial") : "off";
}

export function IntegrationsTabOverview({ overview }: { overview: Overview }) {
  const rows: { label: string; level: StatusLevel; detail: string }[] = [
    { label: "Stripe (payments + identity)", level: stripeLevel(overview), detail: overview.stripe.webhookConfigured ? "Webhook active" : overview.stripe.configured ? "Webhook secret missing" : "Not configured" },
    { label: "Twilio SMS", level: twilioLevel(overview), detail: overview.twilio.statusCallbackConfigured ? "Delivery callbacks active" : overview.twilio.configured ? "App URL missing" : "Not configured" },
    { label: "Resend email", level: resendLevel(overview), detail: overview.resend.webhookConfigured ? "Bounce/complaint webhook active" : overview.resend.configured ? "Webhook secret missing" : "Not configured" },
    { label: "Xero accounting", level: xeroLevel(overview), detail: overview.xero.connected ? `Tenant ${overview.xero.tenantId?.slice(0, 8)}…` : overview.xero.configured ? "Not connected" : "Not configured" },
    { label: "NSW rego check", level: "ok", detail: "Weekly scraper active" },
    { label: "NSW E-Toll", level: overview.etoll.configured ? "ok" : "off", detail: `${overview.etoll.accountCount} account${overview.etoll.accountCount === 1 ? "" : "s"}` },
    { label: "Linkt tolls", level: overview.linkt.configured ? "ok" : "off", detail: overview.linkt.configured ? "Accounts configured" : "No accounts connected" },
    { label: "Calendar (.ics)", level: "ok", detail: "Active on all bookings" },
    { label: "Weather (Open-Meteo)", level: "ok", detail: "3-day forecasts on depot cards" },
    { label: "Web push", level: pushLevel(overview), detail: `${overview.push.subscriptionCount} subscriber${overview.push.subscriptionCount === 1 ? "" : "s"}` },
    { label: "GPS telemetry", level: telemetryLevel(overview), detail: overview.telemetry.ingestConfigured ? `${overview.telemetry.activeDevicesLast7d} active device${overview.telemetry.activeDevicesLast7d === 1 ? "" : "s"}` : "Ingest token not set" },
    { label: "PostHog analytics", level: posthogLevel(overview), detail: overview.posthog.configured ? "Server + browser" : "Not configured" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Webhook deliveries</div><div className="text-2xl font-semibold">{overview.notifications.deliveredLast7d}</div><div className="text-xs text-muted-foreground">last 7 days</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Push subscribers</div><div className="text-2xl font-semibold">{overview.push.subscriptionCount}</div><div className="text-xs text-muted-foreground">{overview.push.deliveredLast24h} delivered 24h</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Telemetry pings</div><div className="text-2xl font-semibold">{overview.telemetry.pingsLast24h}</div><div className="text-xs text-muted-foreground">last 24h</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Failed messages</div><div className="text-2xl font-semibold text-destructive">{overview.notifications.failedLast7d}</div><div className="text-xs text-muted-foreground">last 7 days</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="rounded-md border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-primary text-primary-foreground">
                <tr className="border-b border-primary/40 text-left">
                  <th className="p-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Integration</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
                  <th className="p-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Detail</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {rows.map((r) => (
                  <tr key={r.label} className="border-b last:border-0">
                    <td className="p-3 font-medium">{r.label}</td>
                    <td className="p-3"><div className="flex items-center gap-1.5"><StatusDot level={r.level} /><span className="capitalize text-xs">{r.level === "ok" ? "Connected" : r.level === "partial" ? "Partial" : "Off"}</span></div></td>
                    <td className="p-3 text-muted-foreground">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function fieldsFor(serviceId: string) {
  return INTEGRATION_SERVICES.find((s) => s.id === serviceId)?.fields ?? [];
}

export function IntegrationsTabPayments({ overview }: { overview: Overview }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <IntegrationCard icon={CreditCard} title="Stripe" subtitle="Payments, bond holds, Stripe Identity" level={stripeLevel(overview)}>
          <KV label="Secret key" value={overview.stripe.configured ? "Configured" : "Missing"} />
          <KV label="Webhook secret" value={overview.stripe.webhookConfigured ? "Configured" : "Missing"} />
          <KV label="Identity verification" value={overview.stripe.identityEnabled ? "Enabled" : "Disabled"} />
          <p className="text-xs text-muted-foreground pt-2">Endpoint: <code>/api/webhooks/stripe</code></p>
        </IntegrationCard>
        <IntegrationCard icon={ShieldCheck} title="Licence verification" subtitle="Stripe Identity (DVS-backed document check)" level={stripeLevel(overview)}>
          <p className="text-xs text-muted-foreground">
            Staff start a verification session from each customer&apos;s profile. Results arrive via the Stripe webhook and auto-mark the licence verified.
          </p>
        </IntegrationCard>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Credentials</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Storing Stripe secrets in the database is higher-risk than env vars — changes are audit-logged. SUPER_ADMIN only.
        </p>
        <IntegrationConfigEditor fields={fieldsFor("stripe")} serviceId="stripe" />
      </div>
    </div>
  );
}

export function IntegrationsTabMessaging({ overview }: { overview: Overview }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <IntegrationCard icon={MessageSquare} title="Twilio SMS" subtitle="Outbound SMS with delivery callbacks" level={twilioLevel(overview)}>
          <KV label="Credentials" value={overview.twilio.configured ? "Configured" : "Missing"} />
          <KV label="Status callback URL" value={overview.twilio.statusCallbackConfigured ? "Configured" : "Missing app URL"} />
          <p className="text-xs text-muted-foreground pt-2">Endpoint: <code>/api/webhooks/twilio</code></p>
        </IntegrationCard>
        <IntegrationCard icon={Mail} title="Resend email" subtitle="Transactional email + bounce/complaint webhooks" level={resendLevel(overview)}>
          <KV label="API key" value={overview.resend.configured ? "Configured" : "Missing"} />
          <KV label="Webhook secret" value={overview.resend.webhookConfigured ? "Configured" : "Missing"} />
          <p className="text-xs text-muted-foreground pt-2">Endpoint: <code>/api/webhooks/resend</code></p>
        </IntegrationCard>
      </div>
      <Card>
        <CardContent className="p-4 grid grid-cols-3 gap-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Sent (7 days)</div><div className="text-2xl font-semibold">{overview.notifications.sentLast7d}</div></div>
          <div><div className="text-xs text-muted-foreground">Delivered (7 days)</div><div className="text-2xl font-semibold text-green-600">{overview.notifications.deliveredLast7d}</div></div>
          <div><div className="text-xs text-muted-foreground">Failed (7 days)</div><div className="text-2xl font-semibold text-destructive">{overview.notifications.failedLast7d}</div></div>
        </CardContent>
      </Card>
      <div>
        <h3 className="text-sm font-semibold mb-2">Twilio credentials</h3>
        <IntegrationConfigEditor fields={fieldsFor("twilio")} serviceId="twilio" />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Resend credentials</h3>
        <IntegrationConfigEditor fields={fieldsFor("resend")} serviceId="resend" />
      </div>
    </div>
  );
}

export function IntegrationsTabAccounting({ overview }: { overview: Overview }) {
  const util = trpc.useUtils();
  const disconnect = trpc.admin.disconnectXero.useMutation({
    onSuccess: () => util.admin.integrationsOverview.invalidate(),
  });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <IntegrationCard
        icon={Receipt}
        title="Xero"
        subtitle="Automated invoice + payment sync"
        level={xeroLevel(overview)}
        actions={
          overview.xero.configured ? (
            overview.xero.connected ? (
              <Button size="sm" variant="outline" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>
            ) : (
              <Button size="sm" asChild><a href="/api/integrations/xero/connect">Connect</a></Button>
            )
          ) : null
        }
      >
        <KV label="OAuth credentials" value={overview.xero.configured ? "Configured" : "Missing"} />
        <KV label="Tenant" value={overview.xero.tenantId ?? "—"} muted={!overview.xero.tenantId} />
        <KV label="Token expires" value={overview.xero.tokenExpiresAt ? formatDateTime(overview.xero.tokenExpiresAt) : "—"} muted={!overview.xero.tokenExpiresAt} />
      </IntegrationCard>
      <IntegrationCard icon={CarFront} title="NSW rego check" subtitle="Service NSW — weekly auto-verification for NSW vehicles" level="ok">
        <p className="text-xs text-muted-foreground">
          Playwright-based scraper runs Mondays 04:00 Sydney against check-rego.service.nsw.gov.au. Updates <code>Vehicle.regoExpiry</code> when it drifts.
        </p>
      </IntegrationCard>
      <div className="md:col-span-2">
        <h3 className="text-sm font-semibold mb-2">Xero OAuth credentials</h3>
        <IntegrationConfigEditor fields={fieldsFor("xero")} serviceId="xero" />
      </div>
    </div>
  );
}

export function IntegrationsTabTolls({ overview }: { overview: Overview }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <IntegrationCard icon={Receipt} title="NSW E-Toll" subtitle={`${overview.etoll.accountCount} connected account${overview.etoll.accountCount === 1 ? "" : "s"}`} level={overview.etoll.configured ? "ok" : "off"}>
          <KV label="Last sync" value={overview.etoll.lastSyncAt ? formatDateTime(overview.etoll.lastSyncAt) : "never"} />
          <KV label="Last status" value={overview.etoll.lastSyncStatus ?? "—"} muted={!overview.etoll.lastSyncStatus} />
        </IntegrationCard>
        <IntegrationCard icon={Receipt} title="Linkt (VIC/QLD)" subtitle="Daily Playwright sync for CityLink / LinktGO" level={overview.linkt.configured ? "ok" : "off"}>
          <p className="text-xs text-muted-foreground">
            {overview.linkt.configured
              ? "Accounts configured. Sync runs daily at 03:00 Brisbane."
              : "No Linkt accounts connected yet. Selectors require live-portal tuning on first run."}
          </p>
        </IntegrationCard>
      </div>
      <IntegrationTabEtoll canManage />
    </div>
  );
}

export function IntegrationsTabCustomer({ overview }: { overview: Overview }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <IntegrationCard icon={Calendar} title="Calendar (.ics)" subtitle="Add-to-calendar on booking confirmation" level="ok">
          <p className="text-xs text-muted-foreground">Every booking exposes <code>/api/bookings/[id]/ics</code>.</p>
        </IntegrationCard>
        <IntegrationCard icon={Cloud} title="Weather" subtitle={`${overview.weather.provider} · free, no key`} level="ok">
          <p className="text-xs text-muted-foreground">3-day forecasts shown on depot cards. Booking reminders can skip unsafe-riding days.</p>
        </IntegrationCard>
        <IntegrationCard icon={Bell} title="Web push" subtitle="VAPID-signed browser notifications" level={pushLevel(overview)}>
          <KV label="VAPID server keys" value={overview.push.vapidConfigured ? "Configured" : "Missing"} />
          <KV label="Browser public key" value={overview.push.browserKeyConfigured ? "Configured" : "Missing"} />
          <KV label="Subscriptions" value={overview.push.subscriptionCount} />
          <KV label="Delivered (24h)" value={overview.push.deliveredLast24h} />
        </IntegrationCard>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Web push (VAPID) keys</h3>
        <IntegrationConfigEditor fields={fieldsFor("push")} serviceId="push" />
      </div>
    </div>
  );
}

export function IntegrationsTabOperations({ overview }: { overview: Overview }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <IntegrationCard icon={Satellite} title="GPS telemetry" subtitle="Generic tracker ingest — Bearer-token auth" level={telemetryLevel(overview)}>
          <KV label="Ingest token" value={overview.telemetry.ingestConfigured ? "Configured" : "Missing"} />
          <KV label="Pings (24h)" value={overview.telemetry.pingsLast24h} />
          <KV label="Active devices (7d)" value={overview.telemetry.activeDevicesLast7d} />
          <p className="text-xs text-muted-foreground pt-2">Endpoint: <code>/api/webhooks/telemetry</code></p>
        </IntegrationCard>
        <IntegrationCard icon={BarChart} title="PostHog" subtitle="Product analytics — client autocapture + server events" level={posthogLevel(overview)}>
          <KV label="Server key" value={overview.posthog.configured ? "Configured" : "Missing"} />
          <KV label="Browser key" value={overview.posthog.browserConfigured ? "Configured" : "Missing"} />
          <KV label="Host" value={overview.posthog.host} />
        </IntegrationCard>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">GPS telemetry ingest token</h3>
        <IntegrationConfigEditor fields={fieldsFor("telemetry")} serviceId="telemetry" />
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">PostHog credentials</h3>
        <IntegrationConfigEditor fields={fieldsFor("posthog")} serviceId="posthog" />
      </div>
    </div>
  );
}

export function IntegrationsTabApiKeys() {
  const util = trpc.useUtils();
  const { data: keys } = trpc.admin.listApiKeys.useQuery();
  const create = trpc.admin.createApiKey.useMutation({
    onSuccess: () => util.admin.listApiKeys.invalidate(),
  });
  const revoke = trpc.admin.revokeApiKey.useMutation({
    onSuccess: () => util.admin.listApiKeys.invalidate(),
  });
  const [name, setName] = useState("");
  const [lastCreated, setLastCreated] = useState<string | null>(null);

  async function submit() {
    const res = await create.mutateAsync({ name, permissions: ["read"] });
    setLastCreated(res.plaintext);
    setName("");
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-muted-foreground text-sm">
        Keys are hashed at rest — copy the plaintext when it&apos;s created, you won&apos;t see it again.
      </p>
      <Card>
        <CardHeader><CardTitle className="text-lg">Create API key</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="Key name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={!name || create.isPending} onClick={submit}>Create</Button>
        </CardContent>
      </Card>
      {lastCreated && (
        <Card className="border-primary">
          <CardContent className="p-4 text-sm">
            <strong>New key (copy now):</strong>
            <pre className="bg-muted p-2 mt-2 rounded text-xs overflow-x-auto">{lastCreated}</pre>
          </CardContent>
        </Card>
      )}
      <div className="space-y-2">
        {keys?.length === 0 ? (
          <p className="text-muted-foreground text-sm">No keys.</p>
        ) : (
          keys?.map((k) => (
            <Card key={k.id}>
              <CardContent className="p-3 flex justify-between items-center text-sm">
                <div>
                  <div className="font-medium">{k.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Created {formatDateTime(k.createdAt)}
                    {k.lastUsedAt && ` · last used ${formatDateTime(k.lastUsedAt)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${k.isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {k.isActive ? "active" : "revoked"}
                  </span>
                  {k.isActive && (
                    <Button size="sm" variant="outline" onClick={() => revoke.mutate({ id: k.id })}>Revoke</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
