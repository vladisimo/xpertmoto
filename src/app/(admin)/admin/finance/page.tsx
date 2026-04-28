"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { ExportMenu } from "@/components/admin/export-menu";
import { DepotSelect } from "@/components/admin/depot-select";
import { FinanceStats } from "@/components/admin/finance-stats";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { formatCurrency } from "@/lib/utils";

export default function FinanceOverviewPage() {
  const today = new Date();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(startMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [depotId, setDepotId] = useState<string | undefined>(undefined);

  const { data, isLoading } = trpc.admin.financeSummary.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
  });

  const statsData = useMemo(
    () =>
      data
        ? {
            totalRevenue: data.totalRevenue,
            totalGst: data.totalGst,
            bookingCount: data.bookingCount,
            avgBookingValue: data.avgBookingValue,
            byPaymentType: data.byPaymentType,
            aging: data.aging,
          }
        : undefined,
    [data],
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Finance overview"
        description="Revenue, GST, payment mix and outstanding balances."
        actions={
          <ExportMenu
            report="finance.overview"
            params={{ from, to, depotId }}
          />
        }
      />

      <FinanceTabsBar />

      <div className="flex flex-wrap items-end gap-3 [&>div]:w-full sm:[&>div]:w-auto">
        <div className="space-y-1">
          <Label htmlFor="finance-from" className="text-xs uppercase tracking-wider text-muted-foreground">
            From
          </Label>
          <Input id="finance-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-[160px]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="finance-to" className="text-xs uppercase tracking-wider text-muted-foreground">
            To
          </Label>
          <Input id="finance-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-[160px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Depot</Label>
          <DepotSelect value={depotId} onChange={setDepotId} />
        </div>
      </div>

      <FinanceStats data={statsData} loading={isLoading} />

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="h3">By status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {data.byStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between border-b py-1.5 last:border-0">
                  <StatusBadge status={s.status as StatusKey} />
                  <span className="text-muted-foreground">
                    {s.count} · {formatCurrency(s.revenue)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="h3">Key totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Totals label="Add-ons" value={formatCurrency(data.totalAddons)} />
              <Totals label="Insurance" value={formatCurrency(data.totalInsurance)} />
              <Totals label="Refunds" value={formatCurrency(data.totalRefunds)} />
              <Totals label="Damage charges" value={formatCurrency(data.totalDamage)} />
              <Totals
                label="Outstanding balances"
                value={`${formatCurrency(data.outstandingBalance)} (${data.outstandingCount})`}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <strong className="tabular-nums">{value}</strong>
    </div>
  );
}
