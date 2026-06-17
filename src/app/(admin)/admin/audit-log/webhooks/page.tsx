import { AuditLogTableView } from "@/components/admin/audit-log-table-view";

export default function AuditLogWebhooksPage() {
  return (
    <AuditLogTableView
      baseFilters={{ categoryIn: ["WEBHOOK", "JOB", "API"] }}
      showFilters={{ category: true, status: true, action: true, entity: false, date: true }}
      description="Inbound webhooks (Stripe, Twilio, Resend), scheduled jobs, and direct API calls."
    />
  );
}
