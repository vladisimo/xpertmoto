"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { DepotSelect } from "@/components/admin/depot-select";
import { ExportMenu } from "@/components/admin/export-menu";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { formatCurrency } from "@/lib/utils";

export default function FinanceReconciliationPage() {
  const today = new Date();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(startMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [depotId, setDepotId] = useState<string | undefined>(undefined);

  const { data } = trpc.admin.financeReconciliation.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Finance"
        title="Reconciliation"
        description="Stripe-side vs book-side payment totals with variance."
        actions={<ExportMenu report="finance.reconciliation" params={{ from, to, depotId }} />}
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
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="h3">Stripe side</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Gross" value={formatCurrency(data.stripeGross)} />
              <Row label="Count" value={data.stripeCount.toLocaleString("en-AU")} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="h3">Book side</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Gross" value={formatCurrency(data.bookGross)} />
              <Row label="Count" value={data.bookCount.toLocaleString("en-AU")} />
              <Row label="Refunds" value={formatCurrency(data.refunds)} />
            </CardContent>
          </Card>
        </div>
      )}

      {data && (
        <Card
          className={
            Math.abs(data.variance) > 0.01 ? "border-destructive" : "border-admin-accent"
          }
        >
          <CardHeader>
            <CardTitle className="h3">Variance</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={
                "font-display text-3xl font-semibold tabular-nums " +
                (Math.abs(data.variance) > 0.01 ? "text-destructive" : "text-foreground")
              }
            >
              {formatCurrency(data.variance)}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {Math.abs(data.variance) > 0.01
                ? "Book-side gross does not match Stripe-side gross for the period. Investigate unmatched payments."
                : "Stripe and book-side payments reconcile within one cent."}
            </p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <strong className="tabular-nums">{value}</strong>
    </div>
  );
}
