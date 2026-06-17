"use client";

import { trpc } from "@/lib/trpc/client";
import { IntegrationsTabCustomer } from "@/components/admin/integration-tabs";

export default function IntegrationsCustomerPage() {
  const { data: overview, isLoading } = trpc.admin.integrationsOverview.useQuery();
  if (isLoading || !overview) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Loading integrations…</div>
      </div>
    );
  }
  return <IntegrationsTabCustomer overview={overview} />;
}
