"use client";

import { CreditCard, DollarSign, Percent, Receipt } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent } from "@/components/ui/card";
import { CalloutCard } from "@/components/ui/callout-card";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency } from "@/lib/utils";
import { KpiCard } from "./kpi-card";

export function PaymentsTab() {
  const q = trpc.platform.paymentsUsage.useQuery();
  if (q.isLoading || !q.data) return <LoadingBlock padded="md" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <p className="text-caption text-muted-foreground">
        Stripe processing fees as a cost centre, pulled nightly by
        src/server/jobs/stripe-reconcile.ts (StripeFeeLedger).
      </p>

      {d.source === "placeholder" && d.reason && (
        <CalloutCard tone="info" title="No fees yet" description={d.reason} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Transactions · 30d"
          primary={d.transactionsLast30d.toLocaleString("en-AU")}
          icon={CreditCard}
        />
        <KpiCard
          title="Gross processed · 30d"
          primary={formatCurrency(d.grossProcessedAud)}
          secondary={`${d.paymentCount30d.toLocaleString("en-AU")} Payment rows`}
          icon={DollarSign}
        />
        <KpiCard
          title="Fees · 30d"
          primary={formatCurrency(d.feesAud30d)}
          secondary={`Net: ${formatCurrency(d.netAud30d)}`}
          icon={Receipt}
        />
        <KpiCard
          title="Effective fee %"
          primary={`${d.effectiveFeePct.toFixed(2)}%`}
          secondary="Fees / gross"
          icon={Percent}
        />
      </div>

      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Detailed per-payout reconciliation lives under the existing
          /admin/finance → Reconciliation tab. This view keeps fees isolated
          for platform-level cost modelling.
        </CardContent>
      </Card>

      <div className="rounded-md border bg-muted/50 p-4 text-sm">
        <div className="mb-1 font-semibold">Data source</div>
        <p className="text-muted-foreground">{d.enableHint}</p>
      </div>
    </div>
  );
}
