import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { FleetTabsBar, type FleetTabValue } from "@/components/fleet/fleet-tabs-bar";
import { FleetHeaderActions } from "@/components/fleet/fleet-header-actions";
import { FleetOverviewTab } from "@/components/fleet/fleet-overview-tab";
import { FleetVehiclesTab } from "@/components/fleet/fleet-vehicles-tab";
import { FleetMakesModelsTab } from "@/components/fleet/fleet-makes-models-tab";
import { FleetMaintenanceTab } from "@/components/fleet/fleet-maintenance-tab";
import { FleetInspectionsTab } from "@/components/fleet/fleet-inspections-tab";
import { FleetIncidentsTab } from "@/components/fleet/fleet-incidents-tab";
import { FleetInfringementsTab } from "@/components/fleet/fleet-infringements-tab";
import { FleetTollsTab } from "@/components/fleet/fleet-tolls-tab";
import { FleetSettingsTab } from "@/components/fleet/fleet-settings-tab";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { getSSRHelpers } from "@/lib/trpc/ssr";

const VALID_TABS: readonly FleetTabValue[] = [
  "overview",
  "vehicles",
  "makes-models",
  "maintenance",
  "inspections",
  "incidents",
  "infringements",
  "tolls",
  "settings",
];

function parseTab(raw: string | undefined): FleetTabValue {
  return VALID_TABS.includes(raw as FleetTabValue) ? (raw as FleetTabValue) : "overview";
}

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; depotId?: string }>;
}) {
  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);

  const helpers = await getSSRHelpers();
  if (activeTab === "makes-models") {
    await helpers.vehicleModel.list.prefetch();
  }

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Operations"
        title="Fleet"
        description="Vehicles, maintenance, inspections, and incidents."
        actions={<FleetHeaderActions />}
      />
      <FleetTabsBar activeTab={activeTab} />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "overview" && <FleetOverviewTab />}
        {activeTab === "vehicles" && (
          <FleetVehiclesTab q={sp.q} status={sp.status} depotId={sp.depotId} />
        )}
        {activeTab === "makes-models" && (
          <HydrationBoundary state={dehydrate(helpers.queryClient)}>
            <FleetMakesModelsTab />
          </HydrationBoundary>
        )}
        {activeTab === "maintenance" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <FleetMaintenanceTab />
          </div>
        )}
        {activeTab === "inspections" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <FleetInspectionsTab />
          </div>
        )}
        {activeTab === "incidents" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <FleetIncidentsTab />
          </div>
        )}
        {activeTab === "infringements" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <FleetInfringementsTab />
          </div>
        )}
        {activeTab === "tolls" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <FleetTollsTab />
          </div>
        )}
        {activeTab === "settings" && (
          <FleetSettingsTab q={sp.q} status={sp.status} depotId={sp.depotId} />
        )}
      </div>
    </PageShell>
  );
}
