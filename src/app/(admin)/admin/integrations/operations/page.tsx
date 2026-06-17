"use client";

import { trpc } from "@/lib/trpc/client";
import { IntegrationsTabOperations } from "@/components/admin/integration-tabs";

export default function IntegrationsOperationsPage() {
  const { data: overview, isLoading } = trpc.admin.integrationsOverview.useQuery();
  if (isLoading || !overview) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Loading integrations…</div>
      </div>
    );
  }
  return <IntegrationsTabOperations overview={overview} />;
}
