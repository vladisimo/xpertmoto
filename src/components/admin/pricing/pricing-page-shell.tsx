import * as React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { PricingTabsBar } from "@/components/admin/pricing-tabs-bar";

/**
 * Shared chrome for every Pricing tab route. A wrapper (rather than the section
 * layout) so the Models route can opt into a full-height shell while the other
 * tabs use natural flow.
 */
export function PricingPageShell({
  full = false,
  children,
}: {
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <PageShell full={full}>
      <PageHeader
        eyebrow="Administration"
        title="Pricing"
        description="Base rates, add-ons, insurance tiers, discounts, and seasonal multipliers."
      />
      <PricingTabsBar />
      {children}
    </PageShell>
  );
}
