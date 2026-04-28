"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bike,
  BookOpen,
  ClipboardCheck,
  Gauge,
  Receipt,
  Route,
  Settings,
  Wrench,
} from "lucide-react";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";

export const FLEET_TABS = [
  { value: "overview", label: "Overview", icon: Gauge },
  { value: "vehicles", label: "Vehicles", icon: Bike },
  { value: "makes-models", label: "Makes & Models", icon: BookOpen },
  { value: "maintenance", label: "Maintenance", icon: Wrench },
  { value: "inspections", label: "Inspections", icon: ClipboardCheck },
  { value: "incidents", label: "Incidents", icon: AlertTriangle },
  { value: "infringements", label: "Infringements", icon: Receipt },
  { value: "tolls", label: "Tolls", icon: Route },
  { value: "settings", label: "Settings", icon: Settings },
] as const;

export type FleetTabValue = (typeof FLEET_TABS)[number]["value"];

export function FleetTabsBar({ activeTab }: { activeTab: FleetTabValue }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/staff/fleet?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <MobileScrollTabs className="w-full justify-start sm:w-full">
        {FLEET_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </TabsTrigger>
          );
        })}
      </MobileScrollTabs>
    </Tabs>
  );
}
