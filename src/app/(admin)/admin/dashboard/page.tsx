import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import {
  AdminDashboardTabsBar,
  type AdminDashboardTabValue,
} from "@/components/admin/admin-dashboard-tabs-bar";
import { AdminOverviewTab } from "@/components/admin/admin-overview-tab";
import { AdminRiskTab } from "@/components/admin/admin-risk-tab";
import { AdminDebtTab } from "@/components/admin/admin-debt-tab";
import { AdminSupportTab } from "@/components/admin/admin-support-tab";

const VALID_TABS: readonly AdminDashboardTabValue[] = ["overview", "risk", "debt", "support"];

function parseTab(raw: string | undefined): AdminDashboardTabValue {
  return VALID_TABS.includes(raw as AdminDashboardTabValue)
    ? (raw as AdminDashboardTabValue)
    : "overview";
}

function TabPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      <div className="min-h-[20rem] flex-1 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);

  return (
    <SectionShell section="admin-dashboard">
      <PageShell full>
        <PageHeader
          eyebrow="Administration"
          title="Admin dashboard"
          description="Organisation-wide overview."
        />
        <AdminDashboardTabsBar />

        <Suspense fallback={<TabPlaceholder />}>
          {activeTab === "overview" && <AdminOverviewTab />}
          {activeTab === "risk" && <AdminRiskTab />}
          {activeTab === "debt" && <AdminDebtTab />}
          {activeTab === "support" && <AdminSupportTab />}
        </Suspense>
      </PageShell>
    </SectionShell>
  );
}
