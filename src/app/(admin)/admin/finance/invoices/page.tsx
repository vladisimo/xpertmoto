"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DepotSelect } from "@/components/admin/depot-select";
import { ExportMenu } from "@/components/admin/export-menu";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";

type Row = {
  id: string;
  invoiceNumber: string;
  status: string;
  bookingReference: string | null;
  customer: string | null;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  creditNoteTotal: number;
  dueDate: Date | null;
  sentAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
};

export default function FinanceInvoicesPage() {
  const today = new Date();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(startMonth.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [depotId, setDepotId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string>("");

  const util = trpc.useUtils();
  const { data, isLoading } = trpc.admin.financeInvoices.useQuery({
    from: new Date(from + "T00:00:00.000Z"),
    to: new Date(to + "T23:59:59.999Z"),
    depotId,
    status: status || undefined,
    take: 200,
  });
  const issueCredit = trpc.admin.issueCreditNote.useMutation({
    onSuccess: () => util.admin.financeInvoices.invalidate(),
  });
  const voidInvoice = trpc.admin.voidInvoice.useMutation({
    onSuccess: () => util.admin.financeInvoices.invalidate(),
  });

  function handleCredit(r: Row) {
    const remaining = r.totalAmount - r.creditNoteTotal;
    const raw = window.prompt(
      `Credit note amount (max A$${remaining.toFixed(2)}):`,
      remaining.toFixed(2),
    );
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const reason = window.prompt("Reason for the credit note?") ?? "";
    if (!reason.trim()) return;
    issueCredit.mutate({ invoiceId: r.id, amount, reason: reason.trim() });
  }

  function handleVoid(r: Row) {
    const reason = window.prompt("Reason for voiding this invoice?") ?? "";
    if (!reason.trim()) return;
    if (!window.confirm(`Void invoice ${r.invoiceNumber}? This cannot be undone.`)) return;
    voidInvoice.mutate({ invoiceId: r.id, reason: reason.trim() });
  }

  const columns: DataTableColumn<Row>[] = [
    { id: "invoiceNumber", header: "Number", cell: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span>, primary: true },
    { id: "customer", header: "Customer", cell: (r) => r.customer ?? "—", secondary: true },
    { id: "booking", header: "Booking", cell: (r) => r.bookingReference ?? "—" },
    { id: "subtotal", header: "Subtotal", cell: (r) => <span className="tabular-nums">{formatCurrency(r.subtotal)}</span>, align: "right", mobileHidden: true },
    { id: "gst", header: "GST", cell: (r) => <span className="tabular-nums text-muted-foreground">{formatCurrency(r.gstAmount)}</span>, align: "right", mobileHidden: true },
    { id: "total", header: "Total", cell: (r) => <span className="tabular-nums font-semibold">{formatCurrency(r.totalAmount)}</span>, align: "right" },
    { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status as StatusKey} /> },
    { id: "due", header: "Due", cell: (r) => (r.dueDate ? formatDate(r.dueDate) : "—") },
    { id: "paid", header: "Paid", cell: (r) => (r.paidAt ? formatDateTime(r.paidAt) : "—"), mobileHidden: true },
    { id: "credit", header: "Credited", cell: (r) => r.creditNoteTotal > 0 ? <span className="text-destructive">-{formatCurrency(r.creditNoteTotal)}</span> : "—", align: "right", mobileHidden: true },
  ];

  const renderRowActions = (r: Row) => (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={r.status === "VOID" || r.status === "CREDITED" || issueCredit.isPending}
        onClick={(e) => {
          e.stopPropagation();
          handleCredit(r);
        }}
      >
        Credit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={r.status === "VOID" || voidInvoice.isPending}
        onClick={(e) => {
          e.stopPropagation();
          handleVoid(r);
        }}
      >
        Void
      </Button>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Finance"
        title="Invoices"
        description="Issued invoices with status, balances, and credit notes."
        actions={<ExportMenu report="finance.invoices" params={{ from, to, depotId }} />}
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
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
          <Input placeholder="e.g. PAID" value={status} onChange={(e) => setStatus(e.target.value.toUpperCase())} className="w-full sm:w-[160px]" />
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-4 shadow-sm sm:flex sm:flex-wrap">
          <T label="Count" value={data.totals.count.toLocaleString("en-AU")} />
          <T label="Subtotal" value={formatCurrency(data.totals.subtotal)} />
          <T label="GST" value={formatCurrency(data.totals.gst)} />
          <T label="Total" value={formatCurrency(data.totals.total)} />
        </div>
      )}

      <DataTable<Row>
        columns={columns}
        data={(data?.rows ?? []) as Row[]}
        isLoading={isLoading}
        getRowId={(r) => r.id}
        empty="No invoices in this window."
        mobileMode="cards"
        rowActions={renderRowActions}
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
