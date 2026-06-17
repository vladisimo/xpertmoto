import * as React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { FleetHeaderActions } from "@/components/fleet/fleet-header-actions";
import { FleetTabsBar } from "@/components/fleet/fleet-tabs-bar";

/**
 * Shared Fleet section chrome. Used by the `(hub)` layout for the in-page tabs
 * and re-used directly by the Vehicles route (which lives outside the hub group
 * so the vehicle-detail `[id]` and `new` routes can nest under it).
 */
export function FleetSectionShell({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return (
    <SectionShell section="fleet" isAdmin={isAdmin}>
      <PageShell full>
        <PageHeader
          eyebrow="Operations"
          title="Fleet"
          description="Vehicles, maintenance, inspections, and incidents."
          actions={<FleetHeaderActions />}
        />
        <FleetTabsBar isAdmin={isAdmin} />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </PageShell>
    </SectionShell>
  );
}
