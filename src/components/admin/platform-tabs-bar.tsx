"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Brain,
  CreditCard,
  Database,
  HardDrive,
  Mail,
  MessageSquare,
  Server,
} from "lucide-react";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";

export const PLATFORM_TABS = [
  { value: "database", label: "Database", icon: Database },
  { value: "server", label: "Server", icon: Server },
  { value: "storage", label: "Storage", icon: HardDrive },
  { value: "llm", label: "LLM", icon: Brain },
  { value: "email", label: "Email", icon: Mail },
  { value: "sms", label: "SMS", icon: MessageSquare },
  { value: "payments", label: "Payments", icon: CreditCard },
  { value: "observability", label: "Observability", icon: Activity },
] as const;

export type PlatformTabValue = (typeof PLATFORM_TABS)[number]["value"];

export function PlatformTabsBar({ activeTab }: { activeTab: PlatformTabValue }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/admin/platform?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <MobileScrollTabs className="w-full justify-start sm:w-full">
        {PLATFORM_TABS.map((tab) => {
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
