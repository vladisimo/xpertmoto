"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/stat-shell";
import { ExportMenu } from "@/components/admin/export-menu";
import { DepotSelect } from "@/components/admin/depot-select";
import { FinanceStats } from "@/components/admin/finance-stats";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { cn, formatCurrency } from "@/lib/utils";

// recharts panel — keep it out of the SSR/mobile bundle until it mounts.
const FinanceRevenueTrend = dynamic(
  () => import("@/components/admin/finance-revenue-trend").then((m) => m.FinanceRevenueTrend),
  { ssr: false, loading: () => <LoadingBlock className="h-full w-full" /> },
);

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
  // YoY trend has its own 4-year window — only the depot filter applies.
  const trend = trpc.admin.financeRevenueTrend.useQuery({ depotId });
  // Reconciliation may hit Stripe live in dev, so load it independently of the
  // summary rather than blocking the KPI row on it.
  const recon = trpc.admin.financeReconciliation.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
  });

  const statsData = useMemo(
    () =>
      data
        ? { cash: data.cash, booking: data.booking, outstanding: data.outstanding }
        : undefined,
    [data],
  );

  const variance = recon.data?.summary.variance;
  const reconciled = variance !== undefined && Math.abs(variance) <= 0.01;
  const bondsHeld = data ? data.bonds.held - data.bonds.captured - data.bonds.released : 0;

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Administration"
        title="Finance overview"
        description="Net cash, GST, cash flow and outstanding balances — on the same basis as every Finance tab."
        actions={<ExportMenu report="finance.overview" params={{ from, to, depotId }} />}
        mobileCompact
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

      {/* Fill the remaining viewport — the page itself never scrolls. */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3 lg:grid-rows-1">
        <section className="flex min-h-0 flex-col rounded-lg border bg-card p-4 shadow-sm lg:col-span-2">
          <div className="mb-2">
            <h2 className="h3">Revenue trend</h2>
            <p className="text-xs text-muted-foreground">
              Net cash revenue by month — this year against the past three. Latest year highlighted.
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <FinanceRevenueTrend data={trend.data} loading={trend.isLoading} />
          </div>
        </section>

        <div className="flex min-h-0 flex-col gap-4">
          <Card className="flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="h3">Booking pipeline</CardTitle>
              <p className="text-xs text-muted-foreground">Gross booked value by status (not cash collected).</p>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {!data || data.booking.byStatus.length === 0 ? (
                <p className="py-2 text-muted-foreground">No bookings in range.</p>
              ) : (
                data.booking.byStatus.map((s) => (
                  <div key={s.status} className="flex items-center justify-between border-b py-1.5 last:border-0">
                    <StatusBadge status={s.status as StatusKey} />
                    <span className="text-muted-foreground">
                      {s.count} · <span className="tabular-nums">{formatCurrency(s.revenue)}</span>
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="h3">Reconcile &amp; ledgers</CardTitle>
              <p className="text-xs text-muted-foreground">Jump into the detail tabs.</p>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto text-sm">
              <LedgerRow
                href="/admin/finance/reconciliation"
                label="Stripe vs book"
                value={recon.isLoading ? "—" : reconciled ? "In sync" : formatCurrency(variance ?? 0)}
                tone={!recon.isLoading && !reconciled ? "danger" : undefined}
              />
              <LedgerRow
                href="/admin/finance/invoices"
                label="Invoices outstanding"
                value={
                  data
                    ? `${formatCurrency(data.invoicesOutstanding.amount)} (${data.invoicesOutstanding.count})`
                    : "—"
                }
              />
              <LedgerRow
                href="/admin/finance/bonds"
                label="Bonds held"
                value={data ? formatCurrency(bondsHeld) : "—"}
              />
              <div className="my-2 border-t" />
              <LedgerRow label="Add-ons" value={data ? formatCurrency(data.totals.addons) : "—"} />
              <LedgerRow label="Insurance" value={data ? formatCurrency(data.totals.insurance) : "—"} />
              <LedgerRow
                href="/admin/finance/transactions"
                label="Refunds"
                value={data ? formatCurrency(data.totals.refunds) : "—"}
              />
              <LedgerRow
                href="/admin/finance/transactions"
                label="Damage charges"
                value={data ? formatCurrency(data.totals.damage) : "—"}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function LedgerRow({
  href,
  label,
  value,
  tone,
}: {
  href?: string;
  label: string;
  value: React.ReactNode;
  tone?: "danger";
}) {
  const inner = (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <strong className={cn("tabular-nums", tone === "danger" && "text-destructive")}>{value}</strong>
        {href && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      </span>
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="-mx-2 block rounded border-b px-2 last:border-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {inner}
    </Link>
  ) : (
    <div className="border-b last:border-0">{inner}</div>
  );
}
