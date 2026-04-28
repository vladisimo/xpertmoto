"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DollarSign, LayoutDashboard, LifeBuoy, ShieldAlert } from "lucide-react";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";

export const ADMIN_DASHBOARD_TABS = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "risk", label: "Risk", icon: ShieldAlert },
  { value: "debt", label: "Debt", icon: DollarSign },
  { value: "support", label: "Support", icon: LifeBuoy },
] as const;

export type AdminDashboardTabValue = (typeof ADMIN_DASHBOARD_TABS)[number]["value"];

export function AdminDashboardTabsBar({ activeTab }: { activeTab: AdminDashboardTabValue }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/admin/dashboard?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <MobileScrollTabs className="w-full justify-start sm:w-full">
        {ADMIN_DASHBOARD_TABS.map((tab) => {
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
