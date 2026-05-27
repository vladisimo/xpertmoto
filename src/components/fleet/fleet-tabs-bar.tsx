"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bike,
  BookOpen,
  ClipboardCheck,
  Gauge,
  MapPin,
  Receipt,
  Route,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import {
  FLEET_TAB_VALUES,
  isAdminOnlyFleetTab,
  type FleetTabValue,
} from "@/lib/fleet/tabs";

// Re-export for callers that already import from this module. New code
// should import from @/lib/fleet/tabs directly.
export { FLEET_TAB_VALUES };
export type { FleetTabValue };

const TAB_META: Record<FleetTabValue, { label: string; icon: LucideIcon }> = {
  overview:       { label: "Overview",       icon: Gauge },
  vehicles:       { label: "Vehicles",       icon: Bike },
  "makes-models": { label: "Makes & Models", icon: BookOpen },
  maintenance:    { label: "Maintenance",    icon: Wrench },
  inspections:    { label: "Inspections",    icon: ClipboardCheck },
  incidents:      { label: "Incidents",      icon: AlertTriangle },
  infringements:  { label: "Infringements",  icon: Receipt },
  tolls:          { label: "Tolls",          icon: Route },
  depots:         { label: "Depots",         icon: MapPin },
  settings:       { label: "Settings",       icon: Settings },
};

export function FleetTabsBar({
  activeTab,
  isAdmin = false,
}: {
  activeTab: FleetTabValue;
  /** Admin-only tabs (Depots) only render for ADMIN / SUPER_ADMIN. */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/staff/fleet?${params.toString()}`, { scroll: false });
  };

  const tabs = FLEET_TAB_VALUES.filter(
    (value) => isAdmin || !isAdminOnlyFleetTab(value),
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <MobileScrollTabs className="w-full justify-start sm:w-full">
        {tabs.map((value) => {
          const meta = TAB_META[value];
          const Icon = meta.icon;
          return (
            <TabsTrigger key={value} value={value} className="gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span>{meta.label}</span>
            </TabsTrigger>
          );
        })}
      </MobileScrollTabs>
    </Tabs>
  );
}
