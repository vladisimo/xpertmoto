"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DepotSelect } from "@/components/admin/depot-select";
import { ExportMenu } from "@/components/admin/export-menu";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { formatCurrency } from "@/lib/utils";

type Row = {
  depotId: string;
  depotName: string;
  revenue: number;
  gst: number;
};

export default function FinanceGstPage() {
  const today = new Date();
  const startQuarter = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  const [from, setFrom] = useState(startQuarter.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [depotId, setDepotId] = useState<string | undefined>(undefined);

  const { data, isLoading } = trpc.admin.financeGst.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
  });

  const columns: DataTableColumn<Row>[] = [
    { id: "depot", header: "Depot", cell: (r) => r.depotName },
    { id: "revenue", header: "Revenue (inc GST)", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue)}</span>, align: "right" },
    { id: "ex", header: "Revenue (ex GST)", cell: (r) => <span className="tabular-nums">{formatCurrency(r.revenue - r.gst)}</span>, align: "right" },
    { id: "gst", header: "GST", cell: (r) => <span className="tabular-nums font-semibold">{formatCurrency(r.gst)}</span>, align: "right" },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Finance"
        title="GST / BAS"
        description="GST-inclusive revenue, GST collected, and refund GST for the BAS period."
        actions={<ExportMenu report="finance.gst" params={{ from, to, depotId }} />}
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Summary label="Revenue (inc GST)" value={formatCurrency(data.totalRevenueInc)} />
          <Summary label="Revenue (ex GST)" value={formatCurrency(data.totalRevenueEx)} />
          <Summary label="GST collected" value={formatCurrency(data.gstCollected)} tone="primary" />
          <Summary label="Refund GST" value={formatCurrency(data.gstOnRefunds)} tone="destructive" />
        </div>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Net GST payable</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
              {formatCurrency(data.netGst)}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              GST collected on sales minus GST on refunds. Lodge this amount in your BAS for the selected period.
            </p>
          </CardContent>
        </Card>
      )}

      <DataTable<Row>
        columns={columns}
        data={(data?.byDepot ?? []) as Row[]}
        isLoading={isLoading}
        getRowId={(r) => r.depotId}
        empty="No revenue in this window."
      />
    </PageShell>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "primary" | "destructive" }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 font-display text-xl font-semibold tabular-nums " +
          (tone === "primary"
            ? "text-primary"
            : tone === "destructive"
              ? "text-destructive"
              : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}
