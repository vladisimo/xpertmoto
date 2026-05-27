"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Award,
  FileText,
  Gauge,
  IdCard,
  MessageSquare,
  Settings,
  ShieldAlert,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import {
  CUSTOMER_TAB_VALUES,
  isAdminOnlyCustomerTab,
  type CustomerTabValue,
} from "@/lib/customers/tabs";

// Re-export for callers that already import from this module. New code
// should import from @/lib/customers/tabs directly.
export { CUSTOMER_TAB_VALUES };
export type { CustomerTabValue };

const TAB_META: Record<CustomerTabValue, { label: string; icon: LucideIcon }> = {
  overview:       { label: "Overview",            icon: Gauge },
  directory:      { label: "Directory",           icon: Users },
  verification:   { label: "Verification",        icon: IdCard },
  risk:           { label: "Risk & Compliance",   icon: ShieldAlert },
  loyalty:        { label: "Loyalty & Referrals", icon: Award },
  communications: { label: "Communications",      icon: MessageSquare },
  documents:      { label: "Documents",           icon: FileText },
  settings:       { label: "Settings",            icon: Settings },
  users:          { label: "Users & Roles",       icon: UserCog },
};

export function CustomersTabsBar({
  activeTab,
  isAdmin = false,
}: {
  activeTab: CustomerTabValue;
  /** Admin-only tabs (Users & Roles) only render for ADMIN / SUPER_ADMIN. */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`/staff/customers?${params.toString()}`, { scroll: false });
  };

  const tabs = CUSTOMER_TAB_VALUES.filter(
    (value) => isAdmin || !isAdminOnlyCustomerTab(value),
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
