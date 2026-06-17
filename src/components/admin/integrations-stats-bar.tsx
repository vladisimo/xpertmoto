"use client";

import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc/client";
import { LoadingBlock } from "@/components/ui/stat-shell";

// recharts panel — keep it out of the initial bundle until it mounts.
const IntegrationsStats = dynamic(
  () => import("@/components/admin/integrations-stats").then((m) => m.IntegrationsStats),
  { ssr: false, loading: () => <LoadingBlock className="h-40 w-full" /> },
);

/** The KPI/health row shown above the integration tabs on every route. */
export function IntegrationsStatsBar() {
  const { data: overview, isLoading } = trpc.admin.integrationsOverview.useQuery();
  return <IntegrationsStats overview={overview} loading={isLoading} />;
}
