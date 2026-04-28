"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import { AUDIT_LOG_TABS, type AuditLogTabValue } from "./audit-log-tabs";

export function AuditLogTabsBar({ activeTab }: { activeTab: AuditLogTabValue }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    // Drop tab-scoped filter state when switching tabs so stale filters
    // don't leak into the next view.
    params.delete("cursor");
    router.replace(`/admin/audit-log?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <MobileScrollTabs className="w-full justify-start sm:w-full">
        {AUDIT_LOG_TABS.map((tab) => {
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
