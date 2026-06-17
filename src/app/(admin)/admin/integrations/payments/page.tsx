"use client";

import { trpc } from "@/lib/trpc/client";
import { IntegrationsTabPayments } from "@/components/admin/integration-tabs";

export default function IntegrationsPaymentsPage() {
  const { data: overview, isLoading } = trpc.admin.integrationsOverview.useQuery();
  if (isLoading || !overview) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Loading integrations…</div>
      </div>
    );
  }
  return <IntegrationsTabPayments overview={overview} />;
}
