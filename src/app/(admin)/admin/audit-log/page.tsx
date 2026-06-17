import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { AuditLogTabsBar } from "@/components/admin/audit-log-tabs-bar";
import { AUDIT_LOG_TABS, type AuditLogTabValue } from "@/components/admin/audit-log-tabs";
import { AuditLogOverviewTab } from "@/components/admin/audit-log-overview-tab";
import { AuditLogSecurityTab } from "@/components/admin/audit-log-security-tab";
import { AuditLogTableView } from "@/components/admin/audit-log-table-view";

const VALID_TABS: readonly AuditLogTabValue[] = AUDIT_LOG_TABS.map((t) => t.value);

function parseTab(raw: string | undefined): AuditLogTabValue {
  return (VALID_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as AuditLogTabValue)
    : "overview";
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);

  return (
    <SectionShell section="audit">
      <PageShell full>
        <PageHeader
          eyebrow="Administration"
          title="Audit log"
          description="Immutable record of every logged action across authentication, mutations, page views, jobs, API calls, and webhooks."
        />
        <AuditLogTabsBar />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === "overview" && <AuditLogOverviewTab />}
          {activeTab === "security" && <AuditLogSecurityTab />}
          {activeTab === "authentication" && (
            <AuditLogTableView
              baseFilters={{ categoryIn: ["AUTH"] }}
              showFilters={{ category: false, status: true, action: true, entity: false, date: true }}
              description="Logins, logouts, signups, account linking, lockouts, and rate-limit trips."
            />
          )}
          {activeTab === "mutations" && (
            <AuditLogTableView
              baseFilters={{ categoryIn: ["MUTATION"] }}
              showFilters={{ category: false, status: true, action: true, entity: true, date: true }}
              description="Every write operation through tRPC. Click a row for before/after data diffs."
            />
          )}
          {activeTab === "webhooks" && (
            <AuditLogTableView
              baseFilters={{ categoryIn: ["WEBHOOK", "JOB", "API"] }}
              showFilters={{ category: true, status: true, action: true, entity: false, date: true }}
              description="Inbound webhooks (Stripe, Twilio, Resend), scheduled jobs, and direct API calls."
            />
          )}
          {activeTab === "impersonation" && (
            <AuditLogTableView
              baseFilters={{ impersonatedOnly: true }}
              showFilters={{ category: true, status: true, action: true, entity: true, date: true }}
              description="Actions taken during admin 'view as customer' sessions. Every row carries the admin's user id in impersonatorId."
            />
          )}
          {activeTab === "activity" && (
            <AuditLogTableView
              baseFilters={{ categoryIn: ["PAGE_VIEW", "QUERY"] }}
              showFilters={{ category: true, status: true, action: true, entity: true, date: true }}
              description="Page views and read queries. Use to reconstruct a user's session."
            />
          )}
          {activeTab === "all" && (
            <AuditLogTableView
              showFilters={{ category: true, status: true, action: true, entity: true, date: true }}
              description="Every audit entry, unfiltered. Use the controls above to narrow down."
            />
          )}
        </div>
      </PageShell>
    </SectionShell>
  );
}
