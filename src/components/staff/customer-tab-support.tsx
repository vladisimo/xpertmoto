"use client";

import { trpc } from "@/lib/trpc/client";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDistanceToNow } from "date-fns";

type Row = {
  id: string;
  ticketNumber: string;
  category: "ABANDONED_VEHICLE" | "BREAKDOWN" | "PAYMENT" | "GENERAL";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "ASSIGNED" | "PENDING_CUSTOMER" | "RESOLVED" | "CLOSED";
  summary: string;
  createdAt: Date;
  depot: { name: string } | null;
  linkedBooking: { bookingReference: string } | null;
};

export function CustomerTabSupport({ customerId }: { customerId: string }) {
  const { data, isLoading } = trpc.support.customerTickets.useQuery({ customerId });

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
    {
      id: "priority",
      header: "Priority",
      cell: (r) => <StatusBadge status={r.priority} />,
    },
    { id: "summary", header: "Summary", cell: (r) => r.summary },
    {
      id: "booking",
      header: "Booking",
      cell: (r) => r.linkedBooking ? (
        <span className="font-mono text-xs">{r.linkedBooking.bookingReference}</span>
      ) : "—",
    },
    {
      id: "createdAt",
      header: "Opened",
      cell: (r) => formatDistanceToNow(r.createdAt, { addSuffix: true }),
      accessor: (r) => r.createdAt,
      sortable: true,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="pt-4">
      <DataTable<Row>
        columns={columns}
        data={(data ?? []) as Row[]}
        isLoading={isLoading}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/staff/support/${r.id}`}
        empty="No support tickets for this customer."
      />
    </div>
  );
}
