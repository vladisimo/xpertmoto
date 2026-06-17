import { redirect } from "next/navigation";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { auth } from "@/lib/auth";
import { FleetTabsBar } from "@/components/fleet/fleet-tabs-bar";
import { FleetHeaderActions } from "@/components/fleet/fleet-header-actions";
import { FleetOverviewTab } from "@/components/fleet/fleet-overview-tab";
import { FleetVehiclesTab } from "@/components/fleet/fleet-vehicles-tab";
import { FleetLiveTab } from "@/components/fleet/fleet-live-tab";
import { FleetMakesModelsTab } from "@/components/fleet/fleet-makes-models-tab";
import { FleetMaintenanceTab } from "@/components/fleet/fleet-maintenance-tab";
import { FleetInspectionsTab } from "@/components/fleet/fleet-inspections-tab";
import { FleetIncidentsTab } from "@/components/fleet/fleet-incidents-tab";
import { FleetInfringementsTab } from "@/components/fleet/fleet-infringements-tab";
import { FleetNominationsTab } from "@/components/fleet/fleet-nominations-tab";
import { FleetTollsTab } from "@/components/fleet/fleet-tolls-tab";
import { FleetDepotsTab } from "@/components/fleet/fleet-depots-tab";
import { FleetSettingsTab } from "@/components/fleet/fleet-settings-tab";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { getSSRHelpers } from "@/lib/trpc/ssr";
import { isAdminOnlyFleetTab, isFleetTabValue, type FleetTabValue } from "@/lib/fleet/tabs";

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

function parseTab(raw: string | undefined): FleetTabValue {
  return isFleetTabValue(raw) ? raw : "overview";
}

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; depotId?: string }>;
}) {
  const sp = await searchParams;
  const activeTab = parseTab(sp.tab);

  const session = await auth();
  const isAdmin = ADMIN_ROLES.has(session?.user?.role ?? "");

  // The Depots tab wraps the admin-gated depot management surface. Non-admin
  // staff can't use it, so bounce them back to the default tab.
  if (isAdminOnlyFleetTab(activeTab) && !isAdmin) {
    redirect("/staff/fleet");
  }

  const helpers = await getSSRHelpers();
  if (activeTab === "makes-models") {
    await helpers.vehicleModel.list.prefetch();
  }

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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === "overview" && <FleetOverviewTab />}
          {activeTab === "vehicles" && (
            <FleetVehiclesTab q={sp.q} status={sp.status} depotId={sp.depotId} />
          )}
          {activeTab === "live" && <FleetLiveTab />}
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
          {activeTab === "nominations" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              <FleetNominationsTab />
            </div>
          )}
          {activeTab === "tolls" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              <FleetTollsTab />
            </div>
          )}
          {activeTab === "depots" && isAdmin && <FleetDepotsTab />}
          {activeTab === "settings" && (
            <FleetSettingsTab q={sp.q} status={sp.status} depotId={sp.depotId} />
          )}
        </div>
      </PageShell>
    </SectionShell>
  );
}
