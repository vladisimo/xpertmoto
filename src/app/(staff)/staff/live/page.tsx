import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getSSRHelpers } from "@/lib/trpc/ssr";
import { LiveClient } from "./live-client";

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

function parseTab(v: string | undefined): TabValue {
  if (v === "analytics") return "overview";
  return (TABS as readonly string[]).includes(v ?? "") ? (v as TabValue) : "live";
}

function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function StaffLivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = parseTab(asString(sp.tab));

  const helpers = await getSSRHelpers();
  if (tab === "live") {
    await Promise.all([
      helpers.live.stats.prefetch(),
      helpers.live.activeVisitors.prefetch(),
    ]);
  } else if (tab === "sessions") {
    await helpers.liveAnalytics.sessionsList.prefetch({ page: 1, pageSize: 25 });
  } else if (tab === "interactions") {
    await helpers.liveAnalytics.interactionsList.prefetch({ page: 1, pageSize: 25 });
  } else if (tab === "sales") {
    await helpers.liveAnalytics.salesPerformance.prefetch({});
  } else if (tab === "overview") {
    await helpers.liveAnalytics.overviewSummary.prefetch({
      range: "7D",
      compare: false,
      segment: "ALL",
    });
  } else if (tab === "acquisition") {
    await helpers.liveAnalytics.acquisition.prefetch({
      range: "7D",
      compare: false,
      segment: "ALL",
    });
  } else if (tab === "behaviour") {
    await helpers.liveAnalytics.behaviour.prefetch({
      range: "7D",
      compare: false,
      segment: "ALL",
    });
  } else if (tab === "conversion") {
    await helpers.liveAnalytics.conversion.prefetch({
      range: "7D",
      compare: false,
      segment: "ALL",
    });
  } else if (tab === "retention") {
    await helpers.liveAnalytics.retention.prefetch({
      range: "7D",
      compare: false,
      segment: "ALL",
    });
  } else if (tab === "alerts") {
    await helpers.analyticsConfig.alertsList.prefetch();
  }

  return (
    <HydrationBoundary state={dehydrate(helpers.queryClient)}>
      <LiveClient />
    </HydrationBoundary>
  );
}
