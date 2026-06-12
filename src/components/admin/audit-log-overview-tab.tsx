"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AuditLogSecurityStats } from "./audit-log-security-stats";
import {
  AUDIT_ACTIVITY_RANGES,
  type AuditActivityRange,
} from "./audit-activity-chart";
import { LoadingBlock } from "@/components/ui/stat-shell";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatDateTime } from "@/lib/utils";

// recharts panels — keep them out of the SSR/mobile bundle until they mount.
const AuditLogStats = dynamic(
  () => import("./audit-log-stats").then((m) => m.AuditLogStats),
  { ssr: false, loading: () => <LoadingBlock className="h-40 w-full" /> },
);
const AuditActivityChart = dynamic(
  () => import("./audit-activity-chart").then((m) => m.AuditActivityChart),
  { ssr: false, loading: () => <LoadingBlock className="h-48 w-full" /> },
);

const FAILURES_PAGE_SIZE = 20;

type Cursor = { timestamp: Date; id: string };

type FailureRow = {
  id: string;
  timestamp: Date;
  status: "SUCCESS" | "FAILURE" | "DENIED";
  action: string;
  ipAddress: string | null;
  user: { id: string; firstName: string; lastName: string; email: string } | null;
};

/**
 * Dashboard tab. One range picker at the top drives every query:
 *  - core stats (auditLogStats)
 *  - security rollup (auditSecurityStats)
 *  - website activity chart (auditActivityTimeseries)
 *  - recent failures list (auditLog, scoped with `from`)
 *
 * Layout: the tab fills the PageShell. Stats + chart are shrink-0 above,
 * the failures table takes the remaining height and owns the only scroll
 * region — its header stays sticky while rows scroll underneath.
 */
export function AuditLogOverviewTab() {
  const [range, setRange] = useState<AuditActivityRange>("24h");
  const since = useMemo(() => computeSince(range), [range]);

  const statsQuery = trpc.admin.auditLogStats.useQuery({ range }, { staleTime: 30_000 });
  const securityQuery = trpc.admin.auditSecurityStats.useQuery(
    { range },
    { staleTime: 30_000 },
  );
  const activityQuery = trpc.admin.auditActivityTimeseries.useQuery(
    { range },
    { staleTime: 30_000 },
  );

  const [cursorStack, setCursorStack] = useState<Cursor[]>([]);
  const [prevSinceMs, setPrevSinceMs] = useState(since.getTime());
  if (prevSinceMs !== since.getTime()) {
    setPrevSinceMs(since.getTime());
    setCursorStack([]);
  }

  const currentCursor = cursorStack[cursorStack.length - 1];
  const failuresQuery = trpc.admin.auditLog.useQuery({
    statusIn: ["FAILURE", "DENIED"],
    from: since,
    cursor: currentCursor,
    take: FAILURES_PAGE_SIZE,
  });

  const failureRows = (failuresQuery.data?.rows ?? []) as unknown as FailureRow[];
  const nextCursor = failuresQuery.data?.nextCursor ?? null;
  const pageIndex = cursorStack.length;
  const canPrev = pageIndex > 0;
  const canNext = nextCursor !== null;

  const columns: DataTableColumn<FailureRow>[] = [
    {
      id: "timestamp",
      header: "Timestamp",
      cell: (r) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(r.timestamp)}
        </span>
      ),
      width: "12rem",
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status as StatusKey} />,
      width: "7rem",
    },
    {
      id: "action",
      header: "Action",
      cell: (r) => <span className="truncate font-mono text-xs">{r.action}</span>,
    },
    {
      id: "user",
      header: "User",
      cell: (r) =>
        r.user ? (
          <div className="min-w-0">
            <div className="truncate text-sm">
              {r.user.firstName} {r.user.lastName}
            </div>
            <div className="truncate text-xs text-muted-foreground">{r.user.email}</div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">system</span>
        ),
    },
    {
      id: "ip",
      header: "IP",
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">{r.ipAddress ?? "—"}</span>
      ),
      width: "10rem",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="h3">Overview</h2>
          <p className="text-caption text-muted-foreground">
            Stats, website activity, and recent rejections scoped to the selected range.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Select value={range} onValueChange={(v) => setRange(v as AuditActivityRange)}>
            <SelectTrigger className="h-9 w-[11rem] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIT_ACTIVITY_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="shrink-0 space-y-6">
        <AuditLogStats data={statsQuery.data} loading={statsQuery.isLoading} />
        <AuditLogSecurityStats data={securityQuery.data} loading={securityQuery.isLoading} />

        <AuditActivityChart
          points={activityQuery.data?.points ?? []}
          bucket={activityQuery.data?.bucket ?? "hour"}
          loading={activityQuery.isLoading}
        />
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
            <h2 className="h3">Recent failures &amp; denials</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {FAILURES_PAGE_SIZE} per page
          </span>
        </header>
        <div className="flex-1 overflow-auto">
          <DataTable
            columns={columns}
            data={failureRows}
            getRowId={(r) => r.id}
            isLoading={failuresQuery.isLoading}
            empty="No failures in this window. Nice."
            className="rounded-none border-0 shadow-none"
            stickyHeader
          />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span>
            Page {pageIndex + 1} · {failureRows.length} row
            {failureRows.length === 1 ? "" : "s"}
            {failuresQuery.isFetching ? " · loading…" : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!canPrev || failuresQuery.isFetching}
              onClick={() => setCursorStack((c) => c.slice(0, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canNext || failuresQuery.isFetching}
              onClick={() => {
                if (nextCursor) setCursorStack((c) => [...c, nextCursor]);
              }}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function computeSince(range: AuditActivityRange): Date {
  const now = new Date();
  const d = new Date(now);
  if (range === "24h") d.setTime(now.getTime() - 24 * 60 * 60 * 1000);
  else if (range === "7d") d.setDate(d.getDate() - 7);
  else if (range === "14d") d.setDate(d.getDate() - 14);
  else if (range === "30d") d.setDate(d.getDate() - 30);
  else d.setDate(d.getDate() - 90);
  return d;
}
