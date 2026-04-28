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

type Row = {
  id: string;
  bookingReference: string | null;
  customer: string | null;
  status: string;
  heldAmount: number;
  capturedAmount: number;
  releasedAmount: number;
  createdAt: Date;
};

export default function FinanceBondsPage() {
  const today = new Date();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(startMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [depotId, setDepotId] = useState<string | undefined>(undefined);

  const { data, isLoading } = trpc.admin.financeBonds.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
    take: 200,
  });

  const columns: DataTableColumn<Row>[] = [
    { id: "booking", header: "Booking", cell: (r) => <span className="font-mono text-xs">{r.bookingReference ?? "—"}</span> },
    { id: "customer", header: "Customer", cell: (r) => r.customer ?? "—" },
    { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status as StatusKey} /> },
    { id: "held", header: "Held", cell: (r) => <span className="tabular-nums">{formatCurrency(r.heldAmount)}</span>, align: "right" },
    { id: "captured", header: "Captured", cell: (r) => <span className="tabular-nums text-destructive">{formatCurrency(r.capturedAmount)}</span>, align: "right" },
    { id: "released", header: "Released", cell: (r) => <span className="tabular-nums">{formatCurrency(r.releasedAmount)}</span>, align: "right" },
    { id: "created", header: "Created", cell: (r) => formatDateTime(r.createdAt), accessor: (r) => r.createdAt, sortable: true },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Finance"
        title="Bond ledger"
        description="Deposit holds, captures for damage / late / fuel, and releases."
        actions={<ExportMenu report="finance.bonds" params={{ from, to, depotId }} />}
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
        <div className="flex flex-wrap gap-4 rounded-lg border bg-card p-4 shadow-sm">
          <T label="Count" value={data.totals.count.toLocaleString("en-AU")} />
          <T label="Held" value={formatCurrency(data.totals.held)} />
          <T label="Captured" value={formatCurrency(data.totals.captured)} />
          <T label="Released" value={formatCurrency(data.totals.released)} />
        </div>
      )}

      <DataTable<Row>
        columns={columns}
        data={(data?.rows ?? []) as Row[]}
        isLoading={isLoading}
        getRowId={(r) => r.id}
        empty="No bonds in this window."
      />
    </PageShell>
  );
}

function T({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
