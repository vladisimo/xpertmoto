"use client";

import { CommsTabs } from "@/components/communications/comms-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  emailStatus: "OPTED_IN" | "OPTED_OUT" | "UNSUBSCRIBED";
  smsStatus: "OPTED_IN" | "OPTED_OUT" | "UNSUBSCRIBED";
  reason: string | null;
};

export default function PreferencesPage() {
  const { data, isLoading } = trpc.communication.suppressionList.useQuery({ take: 100 });

  const rows: Row[] = (data?.items ?? []).map((p) => ({
    id: p.user.id,
    name: `${p.user.firstName} ${p.user.lastName}`.trim() || p.user.email || "—",
    email: p.user.email,
    phone: p.user.phone,
    emailStatus: p.marketingEmailUnsubscribedAt
      ? "UNSUBSCRIBED"
      : p.marketingOptIn
      ? "OPTED_IN"
      : "OPTED_OUT",
    smsStatus: p.marketingSmsUnsubscribedAt
      ? "UNSUBSCRIBED"
      : p.marketingSmsOptIn
      ? "OPTED_IN"
      : "OPTED_OUT",
    reason: p.unsubscribeReason,
  }));

  const renderChannelStatus = (status: Row["emailStatus"]) => {
    if (status === "UNSUBSCRIBED") return <StatusBadge status="UNSUBSCRIBED" />;
    if (status === "OPTED_OUT") return <StatusBadge status="OPT_OUT" />;
    return <StatusBadge status="SUCCESS" label="Opted in" />;
  };

  const columns: DataTableColumn<Row>[] = [
    {
      id: "customer",
      header: "Customer",
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.name}</div>
          <div className="truncate text-xs text-muted-foreground">{r.email ?? "—"}</div>
        </div>
      ),
    },
    {
      id: "email",
      header: "Email marketing",
      cell: (r) => renderChannelStatus(r.emailStatus),
    },
    {
      id: "sms",
      header: "SMS marketing",
      cell: (r) => renderChannelStatus(r.smsStatus),
    },
    {
      id: "reason",
      header: "Reason",
      cell: (r) => (
        <span className="truncate text-xs text-muted-foreground">{r.reason ?? "—"}</span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Communications"
        description="Opt-out and suppression list. Transactional notifications still reach these customers — marketing sends are skipped."
      />

      <CommsTabs />

      <PageSection flush>
        <DataTable<Row>
          columns={columns}
          data={isLoading ? undefined : rows}
          getRowId={(r) => r.id}
          getRowHref={(r) => `/staff/customers/${r.id}`}
          empty="No customers have opted out or unsubscribed yet."
        />
      </PageSection>
    </PageShell>
  );
}
