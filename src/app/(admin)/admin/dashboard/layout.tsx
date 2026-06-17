import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { AdminDashboardTabsBar } from "@/components/admin/admin-dashboard-tabs-bar";

/** Admin dashboard section shell — Overview / Risk / Debt / Support tab routes. */
export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SectionShell section="admin-dashboard">
      <PageShell full>
        <PageHeader
          eyebrow="Administration"
          title="Admin dashboard"
          description="Organisation-wide overview."
        />
        <AdminDashboardTabsBar />
        {children}
      </PageShell>
    </SectionShell>
  );
}
