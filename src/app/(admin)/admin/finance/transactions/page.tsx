"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DepotSelect } from "@/components/admin/depot-select";
import { ExportMenu } from "@/components/admin/export-menu";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { isNonCashPayment } from "@/lib/payment-labels";
import type { PaymentType } from "@prisma/client";

type Row = {
  id: string;
  reference: string;
  createdAt: Date;
  type: string;
  method: string;
  status: string;
  amount: number;
  gst: number;
  bookingReference: string | null;
  customer: string | null;
};

export default function FinanceTransactionsPage() {
  const today = new Date();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(startMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [depotId, setDepotId] = useState<string | undefined>(undefined);
  const [type, setType] = useState<string>("");

  const { data, isLoading } = trpc.admin.financeTransactions.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
    type: type || undefined,
    take: 200,
  });

  const columns: DataTableColumn<Row>[] = [
    { id: "reference", header: "Reference", cell: (r) => <span className="font-mono text-xs">{r.reference}</span>, primary: true },
    { id: "createdAt", header: "Date", cell: (r) => formatDateTime(r.createdAt), accessor: (r) => r.createdAt, sortable: true, secondary: true },
    { id: "type", header: "Type", cell: (r) => r.type.replace(/_/g, " ") },
    { id: "method", header: "Method", cell: (r) => r.method, mobileHidden: true },
    { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status as StatusKey} /> },
    { id: "amount", header: "Amount", cell: (r) => <span className={amountClass(r)}>{formatCurrency(r.amount)}</span>, align: "right" },
    { id: "gst", header: "GST", cell: (r) => <span className="tabular-nums text-muted-foreground">{formatCurrency(r.gst)}</span>, align: "right", mobileHidden: true },
    { id: "booking", header: "Booking", cell: (r) => r.bookingReference ?? "—" },
    { id: "customer", header: "Customer", cell: (r) => r.customer ?? "—", mobileHidden: true },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Finance"
        title="Transactions"
        description="Every payment, refund, bond capture, and manual charge across the selected period."
        actions={<ExportMenu report="finance.transactions" params={{ from, to, depotId }} />}
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
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Type</Label>
          <Input placeholder="e.g. REFUND" value={type} onChange={(e) => setType(e.target.value.toUpperCase())} className="w-full sm:w-[200px]" />
        </div>
      </div>

      {data && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-4 rounded-lg border bg-card p-4 shadow-sm sm:flex sm:flex-wrap">
            <Totals label="Count" value={data.totals.count.toLocaleString("en-AU")} />
            <Totals label="Net" value={formatCurrency(data.totals.amount)} />
            <Totals label="GST" value={formatCurrency(data.totals.gst)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Net is cash in minus cash out. Bond holds and releases are card authorisations, not
            cash, so they appear as muted rows but don&rsquo;t affect the total.
          </p>
        </div>
      )}

      <DataTable<Row>
        columns={columns}
        data={(data?.rows ?? []) as Row[]}
        isLoading={isLoading}
        getRowId={(r) => r.id}
        empty="No transactions in this window."
        mobileMode="cards"
      />
    </PageShell>
  );
}

// Bond holds/releases are authorisations, not cash: shown as muted rows and
// excluded from Net. Real outflows (refunds/credits) are negative → destructive.
function amountClass(r: Row): string {
  if (isNonCashPayment(r.type as PaymentType)) return "tabular-nums text-muted-foreground";
  return r.amount < 0 ? "tabular-nums text-destructive" : "tabular-nums";
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
