"use client";

import { use, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutGrid,
  ImageIcon,
  CalendarDays,
  Wrench,
  ClipboardCheck,
  AlertTriangle,
  FileText,
  BookOpen,
  History,
  Edit3,
  Route,
  Navigation,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { VehicleChangeStatusDialog } from "@/components/fleet/vehicle-change-status-dialog";
import {
  VehicleActionButtons,
  VehicleActionSheetsProvider,
} from "@/components/fleet/vehicle-action-sheets";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { VehiclePhotos } from "@/components/fleet/vehicle-photos";
import { VehicleTabOverview } from "@/components/fleet/vehicle-tab-overview";
import { VehicleTabBookings } from "@/components/fleet/vehicle-tab-bookings";
import { VehicleTabTracking } from "@/components/fleet/vehicle-tab-tracking";
import { VehicleTabMaintenance } from "@/components/fleet/vehicle-tab-maintenance";
import { VehicleTabInspections } from "@/components/fleet/vehicle-tab-inspections";
import { VehicleTabIncidents } from "@/components/fleet/vehicle-tab-incidents";
import { VehicleTabTolls } from "@/components/fleet/vehicle-tab-tolls";
import { VehicleTabDocuments } from "@/components/fleet/vehicle-tab-documents";
import { VehicleTabSpecsManuals } from "@/components/fleet/vehicle-tab-specs-manuals";
import { VehicleTabStatusLog } from "@/components/fleet/vehicle-tab-status-log";

const TABS = [
  { value: "overview", label: "Overview", icon: LayoutGrid },
  { value: "photos", label: "Photos", icon: ImageIcon },
  { value: "bookings", label: "Bookings", icon: CalendarDays },
  { value: "tracking", label: "Tracking", icon: Navigation },
  { value: "maintenance", label: "Maintenance", icon: Wrench },
  { value: "inspections", label: "Inspections", icon: ClipboardCheck },
  { value: "incidents", label: "Incidents", icon: AlertTriangle },
  { value: "tolls", label: "Tolls", icon: Route },
  { value: "documents", label: "Documents", icon: FileText },
  { value: "specs", label: "Specifications & manuals", icon: BookOpen },
  { value: "status", label: "Status log", icon: History },
] as const;

export default function VehicleDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "overview";

  const { data, isLoading } = trpc.fleet.vehicleDetail.useQuery({ id });
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const images = data?.vehicle.images;
  const heroImage = useMemo(() => {
    if (!images || images.length === 0) return null;
    return (
      images.find((img) => img.isPrimary) ??
      [...images].sort((a, b) => a.displayOrder - b.displayOrder)[0] ??
      null
    );
  }, [images]);

  const handleTabChange = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading vehicle...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Vehicle not found
      </div>
    );
  }

  const v = data.vehicle;

  return (
    <VehicleActionSheetsProvider vehicleId={v.id}>
      <PageShell>
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <PageHeader
              breadcrumbs={[
                { label: "Fleet", href: "/staff/fleet/vehicles" },
                { label: v.internalCode },
              ]}
              title={`${v.year} ${v.make} ${v.model}`}
              description={
                <span className="flex flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{v.colour}</span>
                    <span className="text-border" aria-hidden>·</span>
                    <span>{v.category.name}</span>
                    <span className="text-border" aria-hidden>·</span>
                    <span>{v.depot.name}</span>
                    <StatusBadge status={v.status as StatusKey} />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setStatusDialogOpen(true)}
                      aria-label="Change status"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-caption">
                    <span>{v.rego} ({v.regoState})</span>
                    <span className="text-border" aria-hidden>·</span>
                    <span>{v.internalCode}</span>
                  </span>
                </span>
              }
              actions={<VehicleActionButtons />}
            />
          </div>
          <button
            type="button"
            onClick={() => handleTabChange("photos")}
            aria-label={heroImage ? "View vehicle photos" : "Add vehicle photos"}
            className="relative hidden aspect-video w-96 shrink-0 rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
          >
            {heroImage ? (
              <Image
                src={heroImage.url}
                alt={heroImage.caption ?? `${v.year} ${v.make} ${v.model}`}
                fill
                className="object-contain"
                sizes="384px"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center gap-2 text-caption text-muted-foreground">
                <ImageIcon className="h-4 w-4" />
                Add photo
              </span>
            )}
          </button>
        </div>

        <VehicleChangeStatusDialog
          vehicle={{ id: v.id, internalCode: v.internalCode, status: v.status }}
          open={statusDialogOpen}
          onOpenChange={setStatusDialogOpen}
        />

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <MobileScrollTabs className="w-full justify-start sm:w-full">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </MobileScrollTabs>
        </Tabs>

        {activeTab === "overview" && <VehicleTabOverview data={data} />}
        {activeTab === "photos" && <VehiclePhotos vehicleId={id} />}
        {activeTab === "bookings" && <VehicleTabBookings vehicle={v} totalCount={data.totalBookings} />}
        {activeTab === "tracking" && (
          <VehicleTabTracking vehicleId={id} canFetchAuthoritative={data.canFetchTrack} />
        )}
        {activeTab === "maintenance" && <VehicleTabMaintenance vehicle={v} />}
        {activeTab === "inspections" && <VehicleTabInspections vehicle={v} />}
        {activeTab === "incidents" && <VehicleTabIncidents vehicle={v} />}
        {activeTab === "tolls" && <VehicleTabTolls vehicle={v} />}
        {activeTab === "documents" && <VehicleTabDocuments vehicle={v} />}
        {activeTab === "specs" && (
          <VehicleTabSpecsManuals vehicle={v} canRefresh={data.canManageCatalogue} />
        )}
        {activeTab === "status" && <VehicleTabStatusLog changeLog={data.changeLog} />}
      </PageShell>
    </VehicleActionSheetsProvider>
  );
}
