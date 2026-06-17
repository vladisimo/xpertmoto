"use client";

import * as React from "react";
import { Mail, MessageCircle, Phone, Smartphone } from "lucide-react";

import { CommsLogDetailDrawer } from "@/components/communications/comms-log-detail-drawer";
import { isSuppressed } from "@/components/communications/delivery-status";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";

export type CommsLogRow = {
  id: string;
  sentAt: string;
  type: string;
  category: string;
  channel: "EMAIL" | "SMS" | "IN_APP" | "PUSH";
  status: string;
  errorMessage: string | null;
  subject: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null } | null;
  campaign: { id: string; name: string } | null;
  templateUsed: string | null;
};

const CHANNEL_ICON: Record<CommsLogRow["channel"], typeof Mail> = {
  EMAIL: Mail,
  SMS: Phone,
  IN_APP: MessageCircle,
  PUSH: Smartphone,
};

export function CommsLogTable({
  data,
  isLoading,
}: {
  data: CommsLogRow[] | undefined;
  isLoading?: boolean;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const columns: DataTableColumn<CommsLogRow>[] = [
    {
      id: "sentAt",
      header: "Sent",
      width: "11rem",
      sortable: true,
      accessor: (r) => r.sentAt,
      cell: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(r.sentAt).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}
        </span>
      ),
    },
    {
      id: "channel",
      header: "Ch",
      width: "3rem",
      cell: (r) => {
        const Icon = CHANNEL_ICON[r.channel];
        return (
          <span title={r.channel} className="inline-flex">
            <Icon className="h-4 w-4 text-muted-foreground" aria-label={r.channel} />
          </span>
        );
      },
    },
    {
      id: "customer",
      header: "Customer",
      cell: (r) =>
        r.customer ? (
          <div className="min-w-0">
            <div className="truncate font-medium">{r.customer.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {r.channel === "SMS" ? r.customer.phone ?? "—" : r.customer.email ?? "—"}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "type",
      header: "Type",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-sm">{formatType(r.type)}</div>
          <div className="text-xs text-muted-foreground">{r.category}</div>
        </div>
      ),
    },
    {
      id: "subject",
      header: "Subject / preview",
      cell: (r) => (
        <span className="truncate text-sm text-muted-foreground">
          {r.subject ?? "—"}
        </span>
      ),
    },
    {
      id: "campaign",
      header: "Campaign",
      cell: (r) =>
        r.campaign ? (
          <span className="truncate text-xs">{r.campaign.name}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <StatusBadge
          status={(isSuppressed(r.errorMessage) ? "SUPPRESSED" : r.status) as StatusKey}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable<CommsLogRow>
        columns={columns}
        data={data}
        isLoading={isLoading}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        empty="No communications match these filters."
        fillHeight
        pageSize={25}
        pageSizeOptions={[25, 50, 100]}
        paginationEmptyLabel="No communications"
      />
      <CommsLogDetailDrawer
        id={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </>
  );
}

function formatType(t: string): string {
  return t.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
