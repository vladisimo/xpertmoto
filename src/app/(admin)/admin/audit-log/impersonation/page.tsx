import { AuditLogTableView } from "@/components/admin/audit-log-table-view";

export default function AuditLogImpersonationPage() {
  return (
    <AuditLogTableView
      baseFilters={{ impersonatedOnly: true }}
      showFilters={{ category: true, status: true, action: true, entity: true, date: true }}
      description="Actions taken during admin 'view as customer' sessions. Every row carries the admin's user id in impersonatorId."
    />
  );
}
