"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatDistanceToNow } from "date-fns";
import { useBranding } from "@/components/shared/branding-provider";

type Row = {
  id: string;
  ticketNumber: string;
  category: "ABANDONED_VEHICLE" | "BREAKDOWN" | "PAYMENT" | "GENERAL";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "ASSIGNED" | "PENDING_CUSTOMER" | "RESOLVED" | "CLOSED";
  summary: string;
  updatedAt: Date;
  depot: { name: string } | null;
  linkedBooking: { bookingReference: string } | null;
};

function TicketMobileCard({ row }: { row: Row }) {
  return (
    <Link
      href={`/dashboard/support/${row.id}`}
      className="block rounded-md border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50 space-y-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-mono text-xs text-muted-foreground truncate">
            {row.ticketNumber}
          </div>
          <div className="font-semibold">{row.summary}</div>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={row.category} />
        <span>·</span>
        <span>Updated {formatDistanceToNow(row.updatedAt, { addSuffix: true })}</span>
      </div>
    </Link>
  );
}

export default function CustomerSupportPage() {
  const { siteName } = useBranding();
  const { data, isLoading } = trpc.support.myTickets.useQuery();
  const rows = (data?.items ?? []) as Row[];

  const columns: DataTableColumn<Row>[] = [
    {
      id: "ticketNumber",
      header: "Ticket",
      cell: (r) => <span className="font-mono text-xs">{r.ticketNumber}</span>,
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => <StatusBadge status={r.category} />,
    },
    { id: "summary", header: "Summary", cell: (r) => r.summary },
    {
      id: "updatedAt",
      header: "Updated",
      cell: (r) => formatDistanceToNow(r.updatedAt, { addSuffix: true }),
      accessor: (r) => r.updatedAt,
      sortable: true,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="My account"
        title="Support"
        description={`Your ongoing and past support tickets with ${siteName}.`}
        actions={
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← Dashboard
          </Link>
        }
      />

      {isLoading ? (
        <PageSection flush>
          <LoadingBlock padded="lg" />
        </PageSection>
      ) : rows.length === 0 ? (
        <PageSection flush>
          <p className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
            You don&apos;t have any support tickets. Use the chat widget to start one.
          </p>
        </PageSection>
      ) : (
        <>
          <div className="md:hidden space-y-2">
            {rows.map((row) => (
              <TicketMobileCard key={row.id} row={row} />
            ))}
          </div>
          <PageSection flush className="hidden md:block">
            <DataTable<Row>
              columns={columns}
              data={rows}
              getRowId={(r) => r.id}
              getRowHref={(r) => `/dashboard/support/${r.id}`}
            />
          </PageSection>
        </>
      )}
    </PageShell>
  );
}
