"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";
import { AuditRowDetail } from "@/components/admin/audit-row-detail";
import { useBranding } from "@/components/shared/branding-provider";

const CATEGORIES = ["AUTH", "PAGE_VIEW", "MUTATION", "QUERY", "JOB", "API", "WEBHOOK"] as const;
const STATUSES = ["SUCCESS", "FAILURE", "DENIED"] as const;
const PAGE_SIZE = 50;

type Category = (typeof CATEGORIES)[number];
type Status = (typeof STATUSES)[number];

type Cursor = { timestamp: Date; id: string };

export type AuditRow = {
  id: string;
  timestamp: Date;
  category: Category;
  action: string;
  entity: string;
  entityId: string | null;
  status: Status;
  durationMs: number | null;
  method: string | null;
  path: string | null;
  errorCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  reqId: string | null;
  depotId: string | null;
  previousData: unknown;
  newData: unknown;
  user: { id: string; firstName: string; lastName: string; email: string } | null;
};

export type AuditQueryInput = {
  from?: Date;
  to?: Date;
  category?: Category;
  categoryIn?: Category[];
  status?: Status;
  statusIn?: Status[];
  action?: string;
  entity?: string;
  /**
   * Filter to rows where `impersonatorId IS NOT NULL` — surfaces every
   * action taken during an admin impersonation session. Matches the
   * Impersonation tab in the audit log.
   */
  impersonatedOnly?: boolean;
  cursor?: Cursor;
  take: number;
};

export type AuditQueryResult = {
  data?: { rows: AuditRow[]; nextCursor: Cursor | null };
  isFetching: boolean;
};

export type AuditQueryHook = (input: AuditQueryInput) => AuditQueryResult;

export interface AuditLogTableViewProps {
  /**
   * Server-side base filters applied on every query. Not shown in the UI
   * and not overridable by the user. Used by category/scope-specific tabs.
   */
  baseFilters?: {
    categoryIn?: Category[];
    statusIn?: Status[];
    actionContains?: string;
    impersonatedOnly?: boolean;
  };
  /**
   * Which user-facing filter controls to render. Default: all on.
   * Disable filters that a tab has already pinned in baseFilters.
   */
  showFilters?: {
    category?: boolean;
    status?: boolean;
    action?: boolean;
    entity?: boolean;
    date?: boolean;
  };
  /**
   * Optional short hint rendered in the filter bar — useful for explaining
   * what a tab is showing before the user drills into rows.
   */
  description?: string;
  /**
   * Whether to show the CSV export button. Defaults to true.
   * Only supported by the default admin query hook.
   */
  showExport?: boolean;
  /**
   * Optional hook override. Defaults to `trpc.admin.auditLog.useQuery`. The
   * staff Activity tab passes `trpc.staffCustomer.activityLog` scoped to a
   * single customer so the same UI works for both admin and staff surfaces.
   */
  queryHook?: AuditQueryHook;
}

const defaultQueryHook: AuditQueryHook = (input) =>
  trpc.admin.auditLog.useQuery(input);

export function AuditLogTableView({
  baseFilters,
  showFilters = {},
  description,
  showExport = true,
  queryHook = defaultQueryHook,
}: AuditLogTableViewProps) {
  const { siteName } = useBranding();
  const auditSlug =
    siteName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "audit";
  const s = {
    category: showFilters.category ?? true,
    status: showFilters.status ?? true,
    action: showFilters.action ?? true,
    entity: showFilters.entity ?? true,
    date: showFilters.date ?? true,
  };

  const [category, setCategory] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const [cursorStack, setCursorStack] = useState<Cursor[]>([]);

  const filters = useMemo(
    () => ({
      category: category ? (category as Category) : undefined,
      categoryIn: baseFilters?.categoryIn,
      status: status ? (status as Status) : undefined,
      statusIn: baseFilters?.statusIn,
      action: (action.trim() || baseFilters?.actionContains) || undefined,
      entity: entity.trim() || undefined,
      impersonatedOnly: baseFilters?.impersonatedOnly,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    }),
    [category, status, action, entity, from, to, baseFilters],
  );

  const filtersKey = JSON.stringify(filters);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setCursorStack([]);
  }

  const currentCursor = cursorStack[cursorStack.length - 1];
  const { data, isFetching } = queryHook({
    ...filters,
    cursor: currentCursor,
    take: PAGE_SIZE,
  });
  const exportCsv = trpc.admin.auditLogExport.useMutation();

  async function handleExport() {
    const res = await exportCsv.mutateAsync({
      from: filters.from,
      to: filters.to,
      category: filters.category,
      status: filters.status,
      action: filters.action,
      entity: filters.entity,
      limit: 10000,
    });
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${auditSlug}-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rows = (data?.rows ?? []) as unknown as AuditRow[];
  const nextCursor = data?.nextCursor ?? null;
  const pageIndex = cursorStack.length;
  const canPrev = pageIndex > 0;
  const canNext = nextCursor !== null;

  const columns: DataTableColumn<AuditRow>[] = [
    {
      id: "timestamp",
      header: "Timestamp",
      secondary: true,
      cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.timestamp)}</span>,
      width: "12rem",
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => <StatusBadge status={r.category as StatusKey} />,
      width: "9rem",
    },
    {
      id: "action",
      header: "Action",
      primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-xs">{r.action}</div>
          {r.path && r.path !== r.action ? (
            <div className="truncate text-xs text-muted-foreground">{r.path}</div>
          ) : null}
        </div>
      ),
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
      id: "entity",
      header: "Entity",
      mobileHidden: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-sm">{r.entity}</div>
          {r.entityId ? (
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {r.entityId.slice(0, 12)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status as StatusKey} />,
      width: "8rem",
    },
    {
      id: "ip",
      header: "IP",
      mobileHidden: true,
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">{r.ipAddress ?? "—"}</span>
      ),
      width: "10rem",
    },
    {
      id: "duration",
      header: "ms",
      mobileHidden: true,
      cell: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {r.durationMs == null ? "—" : r.durationMs}
        </span>
      ),
      align: "right",
      width: "5rem",
    },
  ];

  const filterCount = [s.category, s.status, s.action, s.entity, s.date, s.date].filter(Boolean).length;
  const gridCols =
    filterCount <= 2 ? "md:grid-cols-2" : filterCount <= 4 ? "md:grid-cols-4" : "md:grid-cols-6";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {description ? (
        <p className="shrink-0 text-caption text-muted-foreground">{description}</p>
      ) : null}

      <div className={`grid shrink-0 grid-cols-2 gap-2 ${gridCols}`}>
        {s.category ? (
          <Select value={category || "__all__"} onValueChange={(v) => setCategory(v === "__all__" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {s.status ? (
          <Select value={status || "__all__"} onValueChange={(v) => setStatus(v === "__all__" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {STATUSES.map((st) => (
                <SelectItem key={st} value={st}>
                  {st}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {s.action ? (
          <Input
            placeholder="Action contains…"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        ) : null}
        {s.entity ? (
          <Input
            placeholder="Entity (exact)"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          />
        ) : null}
        {s.date ? (
          <>
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex-1 overflow-auto">
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(r) => r.id}
            onRowClick={(r) => setSelected(r)}
            onMobileRowOpen={(r) => setSelected(r)}
            empty="No audit entries match your filters."
            className="rounded-none border-0 shadow-none"
            stickyHeader
            mobileMode="cards"
          />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span>
            Page {pageIndex + 1} · {rows.length} row{rows.length === 1 ? "" : "s"}
            {isFetching ? " · loading…" : ""}
          </span>
          <div className="flex items-center gap-2">
            {showExport ? (
              <Button onClick={handleExport} disabled={exportCsv.isPending} variant="ghost" size="sm">
                <Download className="h-4 w-4" />
                {exportCsv.isPending ? "Exporting…" : "Export CSV"}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={!canPrev || isFetching}
              onClick={() => setCursorStack((c) => c.slice(0, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canNext || isFetching}
              onClick={() => {
                if (nextCursor) setCursorStack((c) => [...c, nextCursor]);
              }}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-sm">{selected.action}</SheetTitle>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(selected.timestamp)} · {selected.entity}
                  {selected.entityId ? ` · ${selected.entityId}` : ""}
                </p>
              </SheetHeader>

              <div className="mt-6 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Category">
                    <StatusBadge status={selected.category as StatusKey} />
                  </Field>
                  <Field label="Status">
                    <StatusBadge status={selected.status as StatusKey} />
                  </Field>
                  <Field label="User">
                    {selected.user
                      ? `${selected.user.firstName} ${selected.user.lastName} · ${selected.user.email}`
                      : "system"}
                  </Field>
                  <Field label="Duration">
                    {selected.durationMs == null ? "—" : `${selected.durationMs} ms`}
                  </Field>
                  <Field label="IP">{selected.ipAddress ?? "—"}</Field>
                  <Field label="Method">{selected.method ?? "—"}</Field>
                  <Field label="Path">
                    <span className="font-mono text-xs">{selected.path ?? "—"}</span>
                  </Field>
                  <Field label="Error">{selected.errorCode ?? "—"}</Field>
                  <Field label="Request id">
                    <span className="font-mono text-xs">{selected.reqId ?? "—"}</span>
                  </Field>
                  <Field label="Depot">{selected.depotId ?? "—"}</Field>
                </div>

                {selected.userAgent ? (
                  <Field label="User agent">
                    <span className="text-xs text-muted-foreground">{selected.userAgent}</span>
                  </Field>
                ) : null}

                <AuditRowDetail
                  action={selected.action}
                  previousData={selected.previousData}
                  newData={selected.newData}
                />

                {selected.previousData ? (
                  <div>
                    <div className="eyebrow mb-1">Previous data</div>
                    <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(selected.previousData, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {selected.newData ? (
                  <div>
                    <div className="eyebrow mb-1">New data</div>
                    <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(selected.newData, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
