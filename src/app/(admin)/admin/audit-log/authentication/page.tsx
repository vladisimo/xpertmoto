import { AuditLogTableView } from "@/components/admin/audit-log-table-view";

export default function AuditLogAuthenticationPage() {
  return (
    <AuditLogTableView
      baseFilters={{ categoryIn: ["AUTH"] }}
      showFilters={{ category: false, status: true, action: true, entity: false, date: true }}
      description="Logins, logouts, signups, account linking, lockouts, and rate-limit trips."
    />
  );
}
