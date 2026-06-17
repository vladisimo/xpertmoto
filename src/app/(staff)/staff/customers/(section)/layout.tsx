import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { CustomersHeaderActions } from "@/components/staff/customers-header-actions";
import { CustomersTabsBar } from "@/components/staff/customers-tabs-bar";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

/**
 * Customers section shell. Wraps the section's tab routes (Overview,
 * Directory, …) in the dark top bar (lg+) plus the shared page header and the
 * lg:hidden tab strip. The `[id]` customer-detail route lives OUTSIDE this
 * `(section)` route group, so it keeps its own entity header instead of this
 * section bar.
 */
export default async function CustomersSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = ADMIN_ROLES.has(session?.user?.role ?? "");

  return (
    <SectionShell section="customers" isAdmin={isAdmin}>
      <PageShell full>
        <PageHeader
          eyebrow="Operations"
          title="Customers"
          description="Browse, filter, and triage customers across depots."
          actions={<CustomersHeaderActions />}
        />
        <CustomersTabsBar isAdmin={isAdmin} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </PageShell>
    </SectionShell>
  );
}
