"use client";

import { trpc } from "@/lib/trpc/client";
import {
  AuditLogTableView,
  type AuditQueryHook,
} from "@/components/admin/audit-log-table-view";

export function CustomerTabActivity({ customerId }: { customerId: string }) {
  const queryHook: AuditQueryHook = (input) =>
    trpc.staffCustomer.activityLog.useQuery({ ...input, customerId });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground">
          Every event recorded against this customer — registrations, profile
          edits, rentals, payments, incidents, and communications. Click a row
          for the full event details and before/after values.
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
