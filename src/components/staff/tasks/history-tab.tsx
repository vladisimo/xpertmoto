"use client";

import * as React from "react";
import type { StaffTaskActivityStatus, StaffTaskType } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
} from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TASK_TYPE_LABEL } from "@/lib/tasks/tiers";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { HistoryStats } from "./history-stats";

export type HistoryRangePreset = "24h" | "7d" | "30d" | "90d";
export type HistoryStatusFilter = "ALL" | "COMPLETED" | "ABANDONED" | "SUPERSEDED";
export type HistorySortKey = "completedAt" | "workSec" | "cycleSec" | "staff" | "type";

const PRESET_DAYS: Record<HistoryRangePreset, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function rangeFromPreset(preset: HistoryRangePreset): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - PRESET_DAYS[preset] * 24 * 60 * 60 * 1000);
  return { from, to };
}

type HistoryRow = {
  id: string;
  taskType: StaffTaskType;
  status: StaffTaskActivityStatus;
  outcome: string | null;
  outcomeNote: string | null;
  startedAt: Date;
  completedAt: Date | null;
  actionableSinceSnapshot: Date | null;
  staffId: string;
  staffName: string;
  depotId: string | null;
  targetEntityKind: string;
  targetEntityId: string;
  workSec: number;
  waitSec: number | null;
  cycleSec: number | null;
};

export function HistoryTab({
  range,
  status,
  taskType,
  search,
  page,
  pageSize,
  sort,
  onRangeChange,
  onStatusChange,
  onTaskTypeChange,
  onSearchChange,
  onPageChange,
  onPageSizeChange,
  onSortChange,
}: {
  range: HistoryRangePreset;
  status: HistoryStatusFilter;
  taskType: StaffTaskType | "ALL";
  search: string;
  page: number;
  pageSize: number;
  sort: DataTableSortState | null;
  onRangeChange: (next: HistoryRangePreset) => void;
  onStatusChange: (next: HistoryStatusFilter) => void;
  onTaskTypeChange: (next: StaffTaskType | "ALL") => void;
  onSearchChange: (next: string) => void;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number) => void;
  onSortChange: (next: DataTableSortState | null) => void;
}) {
  const { from, to } = React.useMemo(() => rangeFromPreset(range), [range]);
  const [searchDraft, setSearchDraft] = React.useState(search);

  // Debounce free-text search to avoid hammering the query on every keystroke.
  React.useEffect(() => {
    const handle = setTimeout(() => {
      if (searchDraft !== search) onSearchChange(searchDraft);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  React.useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const sortBy = (sort?.id ?? "completedAt") as HistorySortKey;
  const sortDir = sort?.dir ?? "desc";

  const historyQuery = trpc.staffTask.history.useQuery({
    from,
    to,
    taskTypes: taskType === "ALL" ? undefined : [taskType],
    statuses: status === "ALL" ? undefined : [status],
    search: search || undefined,
    page,
    pageSize,
    sortBy,
    sortDir,
  });

  const items = (historyQuery.data?.items ?? []) as HistoryRow[];

  const columns: DataTableColumn<HistoryRow>[] = [
    {
      id: "type",
      header: "Type",
      sortable: true,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium">{TASK_TYPE_LABEL[r.taskType] ?? r.taskType}</span>
          <span className="text-xs text-muted-foreground">
            {r.targetEntityKind}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Outcome",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      id: "staff",
      header: "Closed by",
      sortable: true,
      cell: (r) => (
        <div className="flex flex-col text-xs">
          <span className="font-medium text-foreground">{r.staffName}</span>
          <span className="text-muted-foreground">
            {r.completedAt ? formatDateTime(r.completedAt) : "—"}
          </span>
        </div>
      ),
    },
    {
      id: "queueWait",
      header: "Queue wait",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDuration(r.waitSec ?? undefined)}
        </span>
      ),
    },
    {
      id: "workSec",
      header: "Work time",
      align: "right",
      sortable: true,
      cell: (r) => <span className="tabular-nums">{formatDuration(r.workSec)}</span>,
    },
    {
      id: "cycleSec",
      header: "Total cycle",
      align: "right",
      sortable: true,
      cell: (r) => (
        <span className="tabular-nums font-medium text-foreground">
          {formatDuration(r.cycleSec ?? undefined)}
        </span>
      ),
    },
    {
      id: "note",
      header: "Note",
      cell: (r) => (
        <span className="line-clamp-2 max-w-[24rem] text-xs text-muted-foreground">
          {r.outcomeNote || "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      <HistoryStats data={historyQuery.data?.summary} loading={historyQuery.isLoading} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Range</span>
          <Select value={range} onValueChange={(v) => onRangeChange(v as HistoryRangePreset)}>
            <SelectTrigger className="h-8 w-[9rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Outcome</span>
          <Select
            value={status}
            onValueChange={(v) => onStatusChange(v as HistoryStatusFilter)}
          >
            <SelectTrigger className="h-8 w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All outcomes</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="ABANDONED">Abandoned</SelectItem>
              <SelectItem value="SUPERSEDED">Superseded</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Type</span>
          <Select
            value={taskType}
            onValueChange={(v) => onTaskTypeChange(v as StaffTaskType | "ALL")}
          >
            <SelectTrigger className="h-8 w-[14rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {Object.entries(TASK_TYPE_LABEL).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-1 items-center gap-2 min-w-[12rem]">
          <span className="text-muted-foreground">Search</span>
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search notes…"
            className="h-8"
          />
        </label>
        {historyQuery.isFetching ? (
          <span className="text-xs text-muted-foreground">Refreshing…</span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable
          columns={columns}
          data={historyQuery.isLoading ? undefined : items}
          getRowId={(r) => r.id}
          isLoading={historyQuery.isLoading}
          sort={sort}
          onSortChange={onSortChange}
          empty={
            <span className="text-sm text-muted-foreground">
              No completed tasks in this range.
            </span>
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={historyQuery.data?.page ?? page}
            pageSize={historyQuery.data?.pageSize ?? pageSize}
            totalCount={historyQuery.data?.totalCount ?? 0}
            pageCount={historyQuery.data?.pageCount ?? 1}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      </div>
    </>
  );
}
