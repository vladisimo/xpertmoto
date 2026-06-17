import * as React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { DesktopRecommendedNotice } from "@/components/layout/desktop-recommended-notice";
import { PlatformTabsBar } from "@/components/admin/platform-tabs-bar";

/**
 * Shared chrome for every Platform tab route. Kept in a wrapper (rather than
 * the section layout) so the Observability route can opt into a full-height
 * shell while the other tabs use natural flow.
 */
export function PlatformPageShell({
  full = false,
  children,
}: {
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <PageShell full={full}>
      <PageHeader
        eyebrow="Super admin"
        title="Platform"
        description="Cost-centre telemetry across database, server, storage, LLM and messaging. Numbers here drive the per-customer cost model."
        breadcrumbs={[{ label: "Admin", href: "/admin/dashboard" }, { label: "Platform" }]}
      />
      <PlatformTabsBar />
      <DesktopRecommendedNotice
        className="md:hidden"
        description="Cost-centre charts and timeseries are dense — open this page on a laptop for the full read. Aggregate KPIs at the top of each tab still render below."
      />
      {children}
    </PageShell>
  );
}
