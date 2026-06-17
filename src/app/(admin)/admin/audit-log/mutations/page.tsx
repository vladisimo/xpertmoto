import { AuditLogTableView } from "@/components/admin/audit-log-table-view";

export default function AuditLogMutationsPage() {
  return (
    <AuditLogTableView
      baseFilters={{ categoryIn: ["MUTATION"] }}
      showFilters={{ category: false, status: true, action: true, entity: true, date: true }}
      description="Every write operation through tRPC. Click a row for before/after data diffs."
    />
  );
}
