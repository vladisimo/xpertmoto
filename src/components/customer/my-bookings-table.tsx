"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { BookingCtaText } from "@/components/booking/booking-cta";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

export type MyBookingRow = {
  id: string;
  bookingReference: string;
  status: string;
  categoryName: string;
  pickupDepotName: string;
  bookedAt: Date;
  pickupDateTime: Date;
  returnDateTime: Date;
  totalAmount: number;
};

function EmptyState() {
  return (
    <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground space-y-4">
      <p>You haven’t made any bookings yet.</p>
      <Button asChild variant="secondary">
        <Link href="/booking">
          <Plus className="h-4 w-4" />
          <BookingCtaText initial="Start a booking" resume="Continue booking" />
        </Link>
      </Button>
    </div>
  );
}

function MobileCard({ row }: { row: MyBookingRow }) {
  return (
    <Link
      href={`/dashboard/bookings/${row.id}`}
      className="block rounded-md border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{row.bookingReference}</span>
            <StatusBadge status={row.status as StatusKey} />
          </div>
          <div className="text-sm truncate">{row.categoryName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {row.pickupDepotName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular-nums font-semibold">
            {formatCurrency(row.totalAmount)}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <div className="uppercase tracking-wider text-[10px]">Booked</div>
          <div className="text-foreground">{formatDate(row.bookedAt)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px]">Pickup</div>
          <div className="text-foreground">{formatDateTime(row.pickupDateTime)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-[10px]">Return</div>
          <div className="text-foreground">{formatDateTime(row.returnDateTime)}</div>
        </div>
      </div>
    </Link>
  );
}

export function MyBookingsTable({ data }: { data: MyBookingRow[] }) {
  const columns: DataTableColumn<MyBookingRow>[] = [
    {
      id: "reference",
      header: "Reference",
      sortable: true,
      accessor: (r) => r.bookingReference,
      cell: (r) => <span className="font-medium">{r.bookingReference}</span>,
    },
    {
      id: "ride",
      header: "Ride",
      cell: (r) => (
        <div>
          <div>{r.categoryName}</div>
          <div className="text-xs text-muted-foreground">{r.pickupDepotName}</div>
        </div>
      ),
    },
    {
      id: "booked",
      header: "Booked",
      sortable: true,
      accessor: (r) => r.bookedAt,
      cell: (r) => <span className="text-muted-foreground">{formatDate(r.bookedAt)}</span>,
    },
    {
      id: "pickup",
      header: "Pickup",
      sortable: true,
      accessor: (r) => r.pickupDateTime,
      cell: (r) => <span className="text-muted-foreground">{formatDateTime(r.pickupDateTime)}</span>,
    },
    {
      id: "return",
      header: "Return",
      sortable: true,
      accessor: (r) => r.returnDateTime,
      cell: (r) => <span className="text-muted-foreground">{formatDateTime(r.returnDateTime)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status as StatusKey} />,
    },
    {
      id: "total",
      header: "Total",
      align: "right",
      sortable: true,
      accessor: (r) => r.totalAmount,
      cell: (r) => <span className="tabular-nums font-semibold">{formatCurrency(r.totalAmount)}</span>,
    },
  ];

  if (data.length === 0) return <EmptyState />;

  return (
    <>
      <div className="md:hidden space-y-2">
        {data.map((row) => (
          <MobileCard key={row.id} row={row} />
        ))}
      </div>
      <div className="hidden md:block">
        <DataTable<MyBookingRow>
          columns={columns}
          data={data}
          getRowId={(r) => r.id}
          getRowHref={(r) => `/dashboard/bookings/${r.id}`}
          rowActions={(r) => (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/dashboard/bookings/${r.id}`}>View</Link>
            </Button>
          )}
        />
      </div>
    </>
  );
}
