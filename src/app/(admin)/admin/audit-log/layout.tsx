import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { AuditLogTabsBar } from "@/components/admin/audit-log-tabs-bar";

/** Audit log section shell — one route per event view. */
export default function AuditLogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SectionShell section="audit">
      <PageShell full>
        <PageHeader
          eyebrow="Administration"
          title="Audit log"
          description="Immutable record of every logged action across authentication, mutations, page views, jobs, API calls, and webhooks."
        />
        <AuditLogTabsBar />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </PageShell>
    </SectionShell>
  );
}
