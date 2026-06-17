import { AuditLogTableView } from "@/components/admin/audit-log-table-view";

export default function AuditLogActivityPage() {
  return (
    <AuditLogTableView
      baseFilters={{ categoryIn: ["PAGE_VIEW", "QUERY"] }}
      showFilters={{ category: true, status: true, action: true, entity: true, date: true }}
      description="Page views and read queries. Use to reconstruct a user's session."
    />
  );
}
