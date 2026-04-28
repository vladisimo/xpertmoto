"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";

type OutcomeFilter = "ALL" | "CONVERTED" | "NO_RESPONSE" | "ABANDONED" | "IN_PROGRESS" | "RESOLVED";

type Row = {
  id: string;
  createdAt: Date;
  customer: { firstName: string | null; lastName: string | null; email: string } | null;
  visitor: { country: string | null; landingPath: string | null } | null;
  firstResponseSeconds: number | null;
  interactionOutcome: "CONVERTED" | "NO_RESPONSE" | "ABANDONED" | "IN_PROGRESS" | "RESOLVED" | null;
  attributedBooking: { bookingReference: string; totalAmount: number } | null;
  messageCount: number;
  firstStaff: { firstName: string | null; lastName: string | null } | null;
};

export function InteractionsTab({ active }: { active: boolean }) {
  const [outcome, setOutcome] = React.useState<OutcomeFilter>("ALL");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);

  const query = trpc.liveAnalytics.interactionsList.useQuery(
    {
      outcome: outcome === "ALL" ? undefined : outcome,
      page,
      pageSize,
    },
    { enabled: active, refetchOnWindowFocus: false, staleTime: 30_000 },
  );

  const columns: DataTableColumn<Row>[] = [
    {
      id: "staff",
      header: "Staff",
      cell: (r) =>
        r.firstStaff ? (
          <span className="text-sm">
            {[r.firstStaff.firstName, r.firstStaff.lastName].filter(Boolean).join(" ") || "Staff"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "customer",
      header: "Visitor",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm">
            {r.customer
              ? [r.customer.firstName, r.customer.lastName].filter(Boolean).join(" ") || r.customer.email
              : "Guest"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {r.visitor?.country ?? "—"} · {r.visitor?.landingPath ?? "—"}
          </p>
        </div>
      ),
    },
    {
      id: "started",
      header: "Started",
      cell: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
    },
    {
      id: "firstResponse",
      header: "First response",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.firstResponseSeconds != null ? formatSeconds(r.firstResponseSeconds) : <span className="text-muted-foreground">—</span>}
        </span>
      ),
      align: "right",
    },
    {
      id: "messages",
      header: "Messages",
      cell: (r) => <span className="tabular-nums text-sm">{r.messageCount}</span>,
      align: "right",
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: (r) => (r.interactionOutcome ? <StatusBadge status={r.interactionOutcome} /> : <span className="text-xs text-muted-foreground">pending</span>),
    },
    {
      id: "booking",
      header: "Attributed booking",
      cell: (r) =>
        r.attributedBooking ? (
          <div className="text-right">
            <div className="font-mono text-xs text-primary">{r.attributedBooking.bookingReference}</div>
            <div className="tabular-nums text-[11px] text-muted-foreground">
              ${r.attributedBooking.totalAmount.toLocaleString("en-AU", { minimumFractionDigits: 2 })}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      align: "right",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Outcome</span>
          <Select value={outcome} onValueChange={(v) => { setOutcome(v as OutcomeFilter); setPage(1); }}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="CONVERTED">Converted</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
              <SelectItem value="ABANDONED">Abandoned</SelectItem>
              <SelectItem value="NO_RESPONSE">No response</SelectItem>
              <SelectItem value="IN_PROGRESS">In progress</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto">
          <Button type="button" variant="ghost" size="sm" onClick={() => query.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable<Row>
          columns={columns}
          data={query.isLoading ? undefined : ((query.data?.items ?? []) as Row[])}
          isLoading={query.isLoading}
          getRowId={(r) => r.id}
          empty={<p className="py-4 text-sm text-muted-foreground">No staff interactions yet.</p>}
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={query.data?.page ?? page}
            pageSize={query.data?.pageSize ?? pageSize}
            totalCount={query.data?.totalCount ?? 0}
            pageCount={query.data?.pageCount ?? 1}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
      </div>
    </div>
  );
}

function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
