"use client";

import { trpc } from "@/lib/trpc/client";
import { IntegrationsTabOverview } from "@/components/admin/integration-tabs";

/** Default tab — served at /admin/integrations. */
export default function IntegrationsOverviewPage() {
  const { data: overview, isLoading } = trpc.admin.integrationsOverview.useQuery();
  if (isLoading || !overview) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Loading integrations…</div>
      </div>
    );
  }
  return <IntegrationsTabOverview overview={overview} />;
}
