"use client";

import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { IntegrationsStatsBar } from "@/components/admin/integrations-stats-bar";
import { IntegrationsTabsBar } from "@/components/admin/integrations-tabs-bar";
import { useBranding } from "@/components/shared/branding-provider";

/** Integrations section shell — health row + tab routes. */
export default function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { siteName } = useBranding();
  return (
    <SectionShell section="integrations">
      <PageShell>
        <PageHeader
          eyebrow="Administration"
          title="Integrations"
          description={`Connection status and management for every external service ${siteName} uses.`}
        />
        <IntegrationsStatsBar />
        <IntegrationsTabsBar />
        {children}
      </PageShell>
    </SectionShell>
  );
}
