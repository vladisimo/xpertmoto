"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertOctagon,
  AlertTriangle,
  Bike,
  CalendarClock,
  Disc,
  LifeBuoy,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const STAFF_DASHBOARD_TABS = [
  { value: "today", label: "Today", icon: CalendarClock },
  { value: "overdue", label: "Overdue", icon: AlertTriangle },
  { value: "fleet", label: "Fleet", icon: Bike },
  { value: "mistakes", label: "Mistakes", icon: AlertOctagon },
  { value: "tyres", label: "Tyres", icon: Disc },
  { value: "support", label: "Support", icon: LifeBuoy },
] as const;

export type StaffDashboardTabValue = (typeof STAFF_DASHBOARD_TABS)[number]["value"];

export function StaffDashboardTabsBar({
  activeTab,
  badges,
}: {
  activeTab: StaffDashboardTabValue;
  badges?: Partial<Record<StaffDashboardTabValue, number>>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/staff/dashboard?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList className="w-full justify-start overflow-x-auto">
        {STAFF_DASHBOARD_TABS.map((tab) => {
          const Icon = tab.icon;
          const badge = badges?.[tab.value];
          return (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              {badge != null && badge > 0 && (
                <span className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                  {badge}
                </span>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
