"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import {
  LayoutGrid,
  CreditCard,
  MessagesSquare,
  Receipt,
  Car,
  Sparkles,
  Satellite,
  KeyRound,
} from "lucide-react";
import {
  IntegrationsTabOverview,
  IntegrationsTabPayments,
  IntegrationsTabMessaging,
  IntegrationsTabAccounting,
  IntegrationsTabTolls,
  IntegrationsTabCustomer,
  IntegrationsTabOperations,
  IntegrationsTabApiKeys,
} from "@/components/admin/integration-tabs";
import dynamic from "next/dynamic";
import { LoadingBlock } from "@/components/ui/stat-shell";

// recharts panel — keep it out of the initial bundle until it mounts.
const IntegrationsStats = dynamic(
  () => import("@/components/admin/integrations-stats").then((m) => m.IntegrationsStats),
  { ssr: false, loading: () => <LoadingBlock className="h-40 w-full" /> },
);
import { useBranding } from "@/components/shared/branding-provider";

const TABS = [
  { value: "overview", label: "Overview", icon: LayoutGrid },
  { value: "payments", label: "Payments & ID", icon: CreditCard },
  { value: "messaging", label: "Messaging", icon: MessagesSquare },
  { value: "accounting", label: "Accounting", icon: Receipt },
  { value: "tolls", label: "Tolls", icon: Car },
  { value: "customer", label: "Customer CX", icon: Sparkles },
  { value: "operations", label: "Operations", icon: Satellite },
  { value: "api-keys", label: "API keys", icon: KeyRound },
] as const;

export default function AdminIntegrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { siteName } = useBranding();
  const activeTab = searchParams.get("tab") ?? "overview";
  const { data: overview, isLoading } = trpc.admin.integrationsOverview.useQuery();

  const handleTabChange = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Integrations"
        description={`Connection status and management for every external service ${siteName} uses.`}
      />

      <IntegrationsStats overview={overview} loading={isLoading} />

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

      {isLoading || !overview ? (
        <div className="flex h-64 items-center justify-center">
          <div className="text-muted-foreground">Loading integrations…</div>
        </div>
      ) : (
        <>
          {activeTab === "overview" && <IntegrationsTabOverview overview={overview} />}
          {activeTab === "payments" && <IntegrationsTabPayments overview={overview} />}
          {activeTab === "messaging" && <IntegrationsTabMessaging overview={overview} />}
          {activeTab === "accounting" && <IntegrationsTabAccounting overview={overview} />}
          {activeTab === "tolls" && <IntegrationsTabTolls overview={overview} />}
          {activeTab === "customer" && <IntegrationsTabCustomer overview={overview} />}
          {activeTab === "operations" && <IntegrationsTabOperations overview={overview} />}
          {activeTab === "api-keys" && <IntegrationsTabApiKeys />}
        </>
      )}
    </PageShell>
  );
}
