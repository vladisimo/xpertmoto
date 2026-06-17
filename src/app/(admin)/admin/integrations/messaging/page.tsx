"use client";

import { trpc } from "@/lib/trpc/client";
import { IntegrationsTabMessaging } from "@/components/admin/integration-tabs";

export default function IntegrationsMessagingPage() {
  const { data: overview, isLoading } = trpc.admin.integrationsOverview.useQuery();
  if (isLoading || !overview) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Loading integrations…</div>
      </div>
    );
  }
  return <IntegrationsTabMessaging overview={overview} />;
}
