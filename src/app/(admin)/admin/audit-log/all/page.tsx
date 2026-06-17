import { AuditLogTableView } from "@/components/admin/audit-log-table-view";

export default function AuditLogAllPage() {
  return (
    <AuditLogTableView
      showFilters={{ category: true, status: true, action: true, entity: true, date: true }}
      description="Every audit entry, unfiltered. Use the controls above to narrow down."
    />
  );
}
