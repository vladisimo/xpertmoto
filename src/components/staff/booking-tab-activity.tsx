"use client";

import { trpc } from "@/lib/trpc/client";
import {
  AuditLogTableView,
  type AuditQueryHook,
} from "@/components/admin/audit-log-table-view";

export function BookingTabActivity({ bookingId }: { bookingId: string }) {
  const queryHook: AuditQueryHook = (input) =>
    trpc.staffBooking.activityLog.useQuery({ ...input, bookingId });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground">
          Every event recorded against this booking — creation, payments,
          charges and refunds, bond movements, vehicle swaps, returns,
          inspections, and status changes, by staff and customer alike. Click a
          row for the full event details and before/after values.
        </p>
      </div>
      <AuditLogTableView
        queryHook={queryHook}
        showFilters={{ category: true, status: true, action: true, date: true, entity: false }}
        showExport={false}
      />
    </div>
  );
}
