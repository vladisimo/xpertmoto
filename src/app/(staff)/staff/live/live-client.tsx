"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import { DesktopRecommendedNotice } from "@/components/layout/desktop-recommended-notice";
import { LiveTab } from "./tabs/live-tab";
import { OverviewTab } from "./tabs/overview-tab";
import { AcquisitionTab } from "./tabs/acquisition-tab";
import { BehaviourTab } from "./tabs/behaviour-tab";
import { ConversionTab } from "./tabs/conversion-tab";
import { RetentionTab } from "./tabs/retention-tab";
import { SessionsTab } from "./tabs/sessions-tab";
import { InteractionsTab } from "./tabs/interactions-tab";
import { SalesPerformanceTab } from "./tabs/sales-performance-tab";
import { AlertsTab } from "./tabs/alerts-tab";

const TABS = [
  "live",
  "sessions",
  "interactions",
  "sales",
  "overview",
  "acquisition",
  "behaviour",
  "conversion",
  "retention",
  "alerts",
] as const;
type TabValue = (typeof TABS)[number];

function parseTab(v: string | null): TabValue {
  // Legacy: "analytics" was the single summary tab; redirect to overview.
  if (v === "analytics") return "overview";
  return (TABS as readonly string[]).includes(v ?? "") ? (v as TabValue) : "live";
}

export function LiveClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`/staff/live?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Concierge"
        title="Live visitors"
        description="Real-time visitor console, analytics, and sales-team performance."
      />

      <DesktopRecommendedNotice
        className="md:hidden"
        description="Live analytics is dense and best viewed on a larger screen. Use Live / Alerts on mobile and pull up the rest on a laptop."
      />

      <Tabs
        value={tab}
        onValueChange={(next) => setParams({ tab: next === "live" ? null : next })}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <MobileScrollTabs className="w-max sm:w-max">
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="interactions">Interactions</TabsTrigger>
          <TabsTrigger value="sales">Sales performance</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="acquisition">Acquisition</TabsTrigger>
          <TabsTrigger value="behaviour">Behaviour</TabsTrigger>
          <TabsTrigger value="conversion">Conversion</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </MobileScrollTabs>

        <TabsContent
          value="live"
          className="mt-0 flex min-h-0 flex-1 flex-col gap-4 data-[state=inactive]:hidden"
          forceMount
        >
          <LiveTab active={tab === "live"} />
        </TabsContent>

        <TabsContent value="sessions" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <SessionsTab active={tab === "sessions"} />
        </TabsContent>

        <TabsContent value="interactions" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <InteractionsTab active={tab === "interactions"} />
        </TabsContent>

        <TabsContent value="sales" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <SalesPerformanceTab active={tab === "sales"} />
        </TabsContent>

        <TabsContent value="overview" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <OverviewTab active={tab === "overview"} />
        </TabsContent>

        <TabsContent value="acquisition" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <AcquisitionTab active={tab === "acquisition"} />
        </TabsContent>

        <TabsContent value="behaviour" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <BehaviourTab active={tab === "behaviour"} />
        </TabsContent>

        <TabsContent value="conversion" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <ConversionTab active={tab === "conversion"} />
        </TabsContent>

        <TabsContent value="retention" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <RetentionTab active={tab === "retention"} />
        </TabsContent>

        <TabsContent value="alerts" className="mt-0 data-[state=inactive]:hidden" forceMount>
          <AlertsTab active={tab === "alerts"} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
