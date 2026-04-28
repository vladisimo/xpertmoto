"use client";

import Link from "next/link";

import { CommsTabs } from "@/components/communications/comms-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";

type Row = {
  id: string;
  name: string;
  status: string;
  scheduledFor: string | null;
  sentAt: string | null;
  template: string | null;
  segment: string | null;
  recipients: number;
};

export default function CampaignsPage() {
  const { data, isLoading } = trpc.communication.campaignList.useQuery({ take: 50 });

  const rows: Row[] = (data?.items ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    scheduledFor: c.scheduledFor ? c.scheduledFor.toString() : null,
    sentAt: c.sentAt ? c.sentAt.toString() : null,
    template: c.template?.name ?? null,
    segment: c.segment?.name ?? null,
    recipients: c._count.recipients,
  }));

  const columns: DataTableColumn<Row>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      accessor: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {r.template ?? "Ad-hoc"}{r.segment ? ` · ${r.segment}` : ""}
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status as StatusKey} />,
    },
    {
      id: "schedule",
      header: "Schedule",
      width: "12rem",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.sentAt
            ? `Sent ${new Date(r.sentAt).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}`
            : r.scheduledFor
            ? `Scheduled ${new Date(r.scheduledFor).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}`
            : "Draft"}
        </span>
      ),
    },
    {
      id: "recipients",
      header: "Recipients",
      width: "7rem",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.recipients}</span>,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Communications"
        description="Every scheduled, in-flight, or completed campaign — with per-recipient delivery stats."
        actions={
          <Button asChild>
            <Link href="/staff/communications/compose">New campaign</Link>
          </Button>
        }
      />

      <CommsTabs />

      <PageSection flush>
        <DataTable<Row>
          columns={columns}
          data={isLoading ? undefined : rows}
          getRowId={(r) => r.id}
          empty="No campaigns yet. Compose one from the Compose tab."
        />
      </PageSection>
    </PageShell>
  );
}
