"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell, PageSection } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { DepotSelect } from "@/components/admin/depot-select";
import { ExportMenu } from "@/components/admin/export-menu";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { paymentTypeLabel } from "@/lib/payment-labels";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type {
  ReconRow,
  ReconUnmatched,
} from "@/server/services/finance-reconciliation";
import type { PaymentType } from "@prisma/client";

export default function FinanceReconciliationPage() {
  const today = new Date();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(startMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [depotId, setDepotId] = useState<string | undefined>(undefined);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.financeReconciliation.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
  });

  const refresh = trpc.admin.refreshStripeReconcile.useMutation({
    onSettled: () => utils.admin.financeReconciliation.invalidate(),
  });

  const variance = data?.summary.variance ?? 0;
  const reconciled = Math.abs(variance) <= 0.01;

  const columns: DataTableColumn<ReconRow>[] = [
    {
      id: "reference",
      header: "Reference",
      cell: (r) => (
        <span className="font-mono text-xs">{r.reference ?? "—"}</span>
      ),
      primary: true,
    },
    {
      id: "type",
      header: "Type",
      cell: (r) => (r.type ? paymentTypeLabel(r.type as PaymentType) : "—"),
    },
    {
      id: "stripeChargeId",
      header: "Stripe reference",
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {r.stripeChargeId ?? "—"}
        </span>
      ),
      mobileHidden: true,
    },
    {
      id: "bookAmount",
      header: "Book",
      cell: (r) => (
        <span className="tabular-nums">
          {r.bookAmount === null ? "—" : formatCurrency(r.bookAmount)}
        </span>
      ),
      align: "right",
    },
    {
      id: "stripeAmount",
      header: "Stripe",
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.stripeAmount === null ? "—" : formatCurrency(r.stripeAmount)}
        </span>
      ),
      align: "right",
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status as StatusKey} />,
    },
    {
      id: "booking",
      header: "Booking",
      cell: (r) => r.bookingReference ?? "—",
      mobileHidden: true,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Finance"
        title="Reconciliation"
        description="Per-transaction matching between the book ledger and Stripe."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? "Refreshing…" : "Refresh from Stripe"}
            </Button>
            <ExportMenu report="finance.reconciliation" params={{ from, to, depotId }} />
          </div>
        }
      />

      <FinanceTabsBar />

      <div className="flex flex-wrap items-end gap-3 [&>div]:w-full sm:[&>div]:w-auto">
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-[160px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-[160px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Depot</Label>
          <DepotSelect value={depotId} onChange={setDepotId} />
        </div>
      </div>

      {data && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="h3">Stripe net</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-display text-3xl font-semibold tabular-nums">
                {formatCurrency(data.summary.stripeNet)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="h3">Book net</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-display text-3xl font-semibold tabular-nums">
                {formatCurrency(data.summary.bookNet)}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Cash-settling payments only; bond holds/releases excluded, refunds netted.
              </p>
            </CardContent>
          </Card>
          <Card className={reconciled ? "border-admin-accent" : "border-destructive"}>
            <CardHeader>
              <CardTitle className="h3">Variance</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={
                  "font-display text-3xl font-semibold tabular-nums " +
                  (reconciled ? "text-foreground" : "text-destructive")
                }
              >
                {formatCurrency(variance)}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.summary.matchedCount} matched · {data.summary.unmatchedCount} unmatched
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <PageSection title="Transactions" flush>
        <DataTable<ReconRow>
          columns={columns}
          data={data?.rows}
          isLoading={isLoading}
          getRowId={(r) => r.key}
          getRowHref={(r) => (r.bookingId ? `/admin/bookings/${r.bookingId}` : undefined)}
          mobileMode="cards"
          empty="No payments or Stripe charges in this period."
        />
      </PageSection>

      {data && data.unmatched.length > 0 && (
        <PageSection
          title="Open discrepancies"
          description="Recorded by the nightly Stripe reconcile job and not yet resolved."
        >
          <ul className="space-y-2 text-sm">
            {data.unmatched.map((u: ReconUnmatched) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
              >
                <span className="flex items-center gap-2">
                  <StatusBadge
                    status={u.source === "STRIPE_CHARGE" ? "MISSING_IN_BOOK" : "MISSING_IN_STRIPE"}
                  />
                  <span className="font-mono text-xs">{u.externalId}</span>
                  <span className="text-muted-foreground">{u.reason}</span>
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  <span>{formatCurrency(u.amount)}</span>
                  <span className="text-muted-foreground">{formatDateTime(u.occurredAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </PageSection>
      )}
    </PageShell>
  );
}
