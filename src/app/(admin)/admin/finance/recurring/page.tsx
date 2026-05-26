"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { DepotSelect } from "@/components/admin/depot-select";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { FinanceRecurring } from "@/components/admin/finance-recurring";

export default function FinanceRecurringPage() {
  const [depotId, setDepotId] = useState<string | undefined>(undefined);
  // A single-depot deployment has nothing to filter — hide the selector so the
  // tab isn't cluttered with a no-op control. Multi-depot tenants keep it.
  const { data: depots } = trpc.depot.list.useQuery();
  const showDepotFilter = (depots?.length ?? 0) > 1;

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Finance"
        title="Recurring payments"
        description="Long-term-hire billing — forward forecast, portfolio health and what's been collected."
        mobileCompact
      />

      <FinanceTabsBar />

      {showDepotFilter && (
        <div className="flex flex-wrap items-end gap-3 [&>div]:w-full sm:[&>div]:w-auto">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Depot</Label>
            <DepotSelect value={depotId} onChange={setDepotId} />
          </div>
        </div>
      )}

      <FinanceRecurring depotId={showDepotFilter ? depotId : undefined} />
    </PageShell>
  );
}
