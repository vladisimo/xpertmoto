"use client";

import { CommsTabs } from "@/components/communications/comms-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";

type Row = {
  id: string;
  type: string;
  enabled: boolean;
  channels: string[];
  description: string | null;
};

const DEFAULT_TRIGGERS: Array<{ type: string; description: string }> = [
  { type: "BOOKING_CONFIRMATION", description: "Sent when a booking is paid and confirmed." },
  { type: "BOOKING_REMINDER", description: "24h before pickup (daily 07:00)." },
  { type: "BOOKING_DUE_TODAY", description: "On the morning of the return date." },
  { type: "BOOKING_OVERDUE", description: "When return is more than 1h late." },
  { type: "BOOKING_EXTENDED", description: "When a booking return date is extended." },
  { type: "BOOKING_CANCELLED", description: "When a booking is cancelled by customer or staff." },
  { type: "PAYMENT_RECEIVED", description: "On successful Stripe charge." },
  { type: "INVOICE_ISSUED", description: "When an invoice is issued." },
  { type: "BOND_RELEASED", description: "After the configured post-return hold period." },
  { type: "BOND_CAPTURED", description: "When bond is captured for damage." },
  { type: "PROFILE_UPDATED_SELF", description: "Customer edited their own profile." },
  { type: "PROFILE_UPDATED_STAFF", description: "Staff edited a customer's profile." },
  { type: "LICENCE_EXPIRING", description: "30 / 14 / 7 days before licence expiry." },
  { type: "INCIDENT_REPORTED", description: "When a new incident is logged against a booking." },
  { type: "INFRINGEMENT_NOMINATED", description: "When an infringement is nominated to the customer." },
  { type: "VEHICLE_EXPIRY", description: "Rego / CTP / insurance renewal approaching." },
  { type: "LOW_FLEET_AVAILABILITY", description: "When fleet availability drops under 20%." },
  { type: "DAILY_OPS_SUMMARY", description: "Daily ops digest to managers." },
  { type: "WEEKLY_REVENUE_SUMMARY", description: "Weekly revenue digest to admins." },
];

export default function AutomationsPage() {
  const { data, isLoading } = trpc.communication.automationList.useQuery();

  const configured = Object.fromEntries(
    (data ?? []).map((a) => [a.type as string, a]),
  );

  const rows: Row[] = DEFAULT_TRIGGERS.map((t) => {
    const cfg = configured[t.type];
    return {
      id: t.type,
      type: t.type,
      enabled: cfg?.enabled ?? true,
      channels: cfg?.channels ?? ["EMAIL"],
      description: cfg?.description ?? t.description,
    };
  });

  const columns: DataTableColumn<Row>[] = [
    {
      id: "type",
      header: "Trigger",
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{formatType(r.type)}</div>
          <div className="truncate text-xs text-muted-foreground">{r.description}</div>
        </div>
      ),
    },
    {
      id: "channels",
      header: "Channels",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.channels.map((c) => (
            <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {c}
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) =>
        r.enabled ? (
          <StatusBadge status="ACTIVE" label="On" />
        ) : (
          <StatusBadge status="CANCELLED" label="Off" />
        ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Communications"
        description="Automatic triggers that fire transactional and operational notifications. Edit templates in Admin → Templates."
      />

      <CommsTabs />

      <PageSection flush>
        <DataTable<Row>
          columns={columns}
          data={isLoading ? undefined : rows}
          getRowId={(r) => r.id}
          empty="No automations configured."
        />
      </PageSection>
    </PageShell>
  );
}

function formatType(t: string) {
  return t.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
