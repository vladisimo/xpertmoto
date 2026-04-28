"use client";

import Link from "next/link";
import { AlertTriangle, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { NotReturnedBooking } from "@/server/services/staff-ops-signals";

const STAGE_LABEL: Record<number, string> = {
  0: "Stage 0 — due",
  1: "Stage 1 — notice sent",
  2: "Stage 2 — second nudge",
  3: "Stage 3 — manager",
  4: "Stage 4 — theft filed",
};

export function NotReturnedBikes({ rows }: { rows: NotReturnedBooking[] }) {
  const columns: DataTableColumn<NotReturnedBooking>[] = [
    {
      id: "booking",
      header: "Booking",
      cell: (r) => (
        <div>
          <div className="font-medium">{r.bookingReference}</div>
          <div className="text-xs text-muted-foreground">{r.category.name}</div>
        </div>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      cell: (r) => (
        <div>
          <div className="font-medium">
            {r.customer.firstName} {r.customer.lastName}
          </div>
          {r.customer.phone ? (
            <a
              href={`tel:${r.customer.phone}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <PhoneCall className="h-3 w-3" aria-hidden /> {r.customer.phone}
            </a>
          ) : (
            <div className="text-xs text-muted-foreground">{r.customer.email}</div>
          )}
        </div>
      ),
    },
    {
      id: "vehicle",
      header: "Vehicle",
      cell: (r) =>
        r.vehicle ? (
          <div>
            <div className="font-medium">{r.vehicle.internalCode}</div>
            <div className="text-xs text-muted-foreground">
              {r.vehicle.rego} · {r.vehicle.make} {r.vehicle.model}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not allocated</span>
        ),
    },
    {
      id: "return",
      header: "Return due",
      cell: (r) => (
        <div>
          <div>{formatDateTime(r.returnDateTime)}</div>
          <div className="text-xs font-medium text-destructive">
            {r.hoursOverdue}h overdue
          </div>
        </div>
      ),
    },
    {
      id: "stage",
      header: "Stage",
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status="OVERDUE" label={STAGE_LABEL[r.overdueStage] ?? `Stage ${r.overdueStage}`} />
          {r.balanceDue > 0 && (
            <span className="text-xs text-muted-foreground">
              {formatCurrency(r.balanceDue)} owed
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      empty={
        <div className="flex flex-col items-center gap-1 py-4">
          <span>No overdue returns right now.</span>
        </div>
      }
      rowActions={(r) => (
        <div className="flex items-center gap-2">
          {r.customer.phone && (
            <Button asChild size="sm" variant="ghost">
              <a href={`tel:${r.customer.phone}`} aria-label="Call customer">
                <PhoneCall className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          )}
          <Button asChild size="sm">
            <Link href={`/staff/bookings/${r.id}/check-in`}>
              <AlertTriangle className="mr-1 h-3.5 w-3.5" aria-hidden />
              Check in
            </Link>
          </Button>
        </div>
      )}
    />
  );
}
