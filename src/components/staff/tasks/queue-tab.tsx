"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { StaffTaskTier } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TASK_TYPE_LABEL } from "@/lib/tasks/tiers";
import { cn, formatDateTime } from "@/lib/utils";
import { TasksStats } from "./tasks-stats";
import { AbandonDialog } from "./abandon-dialog";

type TaskListEntry = {
  composedId: string;
  taskType: import("@prisma/client").StaffTaskType;
  targetEntityKind: string;
  targetEntityId: string;
  tier: StaffTaskTier;
  depotId: string | null;
  title: string;
  subtitle?: string;
  summary?: string;
  referenceCode?: string;
  actionUrl: string;
  actionableSince: Date;
  dueAt?: Date | null;
  ageSeconds: number;
  metadata?: Record<string, unknown>;
  links?: {
    bookingId?: string;
    customerId?: string;
    vehicleId?: string;
  };
  inProgress: {
    activityId: string;
    staffId: string;
    staffName: string;
    startedAt: Date;
    isMine: boolean;
  } | null;
};

type TierFilter = StaffTaskTier | "ALL";

export function QueueTab({
  depotId,
  tierFilter,
  onlyMine,
  page,
  pageSize,
  onTierFilterChange,
  onOnlyMineChange,
  onPageChange,
  onPageSizeChange,
}: {
  depotId: string | null;
  tierFilter: TierFilter;
  onlyMine: boolean;
  page: number;
  pageSize: number;
  onTierFilterChange: (next: TierFilter) => void;
  onOnlyMineChange: (next: boolean) => void;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number) => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const listQuery = trpc.staffTask.list.useQuery(
    {
      depotId: depotId ?? undefined,
      onlyMine,
      tiers: tierFilter === "ALL" ? undefined : [tierFilter],
    },
    { refetchInterval: 30_000 },
  );

  const start = trpc.staffTask.start.useMutation({
    onSuccess: (res) => router.push(res.redirectUrl),
    onError: (err) => {
      alert(err.message);
      utils.staffTask.list.invalidate();
    },
  });
  const continueMut = trpc.staffTask.continue.useMutation({
    onSuccess: (res) => router.push(res.redirectUrl),
  });
  const abandon = trpc.staffTask.abandon.useMutation({
    onSuccess: () => {
      utils.staffTask.list.invalidate();
      utils.staffTask.myActive.invalidate();
    },
  });

  const [abandonTarget, setAbandonTarget] = React.useState<string | null>(null);

  const tasks = React.useMemo(
    () => (listQuery.data?.tasks ?? []) as TaskListEntry[],
    [listQuery.data],
  );

  const pageCount = Math.max(1, Math.ceil(tasks.length / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const pageSlice = React.useMemo(
    () => tasks.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
    [tasks, clampedPage, pageSize],
  );

  const columns: DataTableColumn<TaskListEntry>[] = [
    {
      id: "tier",
      header: "Priority",
      width: "6rem",
      cell: (t) => <StatusBadge status={t.tier} />,
    },
    {
      id: "type",
      header: "Type",
      cell: (t) => (
        <div className="flex flex-col">
          <span className="font-medium">{TASK_TYPE_LABEL[t.taskType]}</span>
          {t.referenceCode ? (
            <span className="text-xs text-muted-foreground">{t.referenceCode}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "summary",
      header: "Task",
      cell: (t) => (
        <div className="flex flex-col">
          <span>{t.title}</span>
          {t.subtitle ? (
            <span className="text-xs text-muted-foreground">{t.subtitle}</span>
          ) : null}
          {t.summary ? <span className="text-xs text-muted-foreground">{t.summary}</span> : null}
        </div>
      ),
    },
    {
      id: "claimed",
      header: "Claimed by",
      cell: (t) =>
        t.inProgress ? (
          <div className="flex flex-col text-xs">
            <span className={cn(t.inProgress.isMine && "font-medium text-primary")}>
              {t.inProgress.staffName}
              {t.inProgress.isMine && " (you)"}
            </span>
            <span className="text-muted-foreground">
              since {formatDateTime(t.inProgress.startedAt)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      width: "15rem",
      cell: (t) => {
        let action: React.ReactNode;
        if (t.inProgress) {
          if (t.inProgress.isMine) {
            action = (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    continueMut.mutate({
                      activityId: t.inProgress!.activityId,
                      actionUrl: t.actionUrl,
                    })
                  }
                  disabled={continueMut.isPending}
                >
                  Continue
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAbandonTarget(t.inProgress!.activityId)}
                >
                  Abandon
                </Button>
              </>
            );
          } else {
            action = (
              <Button size="sm" variant="secondary" disabled>
                Claimed
              </Button>
            );
          }
        } else {
          action = (
            <Button
              size="sm"
              onClick={() =>
                start.mutate({
                  taskType: t.taskType,
                  targetEntityId: t.targetEntityId,
                  targetEntityKind: t.targetEntityKind,
                  tier: t.tier,
                  actionUrl: t.actionUrl,
                  depotId: t.depotId ?? undefined,
                  metadata: t.metadata,
                  actionableSince: t.actionableSince,
                })
              }
              disabled={start.isPending}
            >
              Start
            </Button>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <ViewMenu links={t.links} />
            {action}
          </div>
        );
      },
    },
  ];

  const statsInput = React.useMemo(
    () => ({
      tasks: tasks.map((t) => ({
        tier: t.tier,
        ageSeconds: t.ageSeconds,
        inProgress: t.inProgress ? { isMine: t.inProgress.isMine } : null,
      })),
    }),
    [tasks],
  );

  return (
    <>
      <TasksStats input={statsInput} loading={listQuery.isLoading} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Priority</span>
          <Select
            value={tierFilter}
            onValueChange={(v) => onTierFilterChange(v as TierFilter)}
          >
            <SelectTrigger className="h-8 w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All tiers</SelectItem>
              <SelectItem value="URGENT">Urgent</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => onOnlyMineChange(e.target.checked)}
          />
          <span>Only show tasks claimed by me</span>
        </label>
        {listQuery.data?.degraded ? (
          <span className="text-xs text-secondary">
            Some collectors failed or timed out: {listQuery.data.failedCollectors.join(", ")}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable
          columns={columns}
          data={pageSlice}
          getRowId={(t) => t.composedId}
          isLoading={listQuery.isLoading}
          empty={
            <span className="text-sm text-muted-foreground">No tasks — inbox zero.</span>
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={clampedPage}
            pageSize={pageSize}
            totalCount={tasks.length}
            pageCount={pageCount}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      </div>

      {abandonTarget ? (
        <AbandonDialog
          activityId={abandonTarget}
          onClose={() => setAbandonTarget(null)}
          onSubmit={(reason, force) => {
            abandon.mutate(
              { activityId: abandonTarget, reason, force },
              { onSettled: () => setAbandonTarget(null) },
            );
          }}
          pending={abandon.isPending}
        />
      ) : null}
    </>
  );
}

/**
 * Read-only deep-links to the task's related entities. Unlike "Start", these
 * navigate without claiming the task, so staff can peek at the booking,
 * customer, or asset before committing to the work. Renders nothing when the
 * task carries no linkable entities.
 */
function ViewMenu({ links }: { links?: TaskListEntry["links"] }) {
  const items: { label: string; href: string }[] = [];
  if (links?.bookingId) {
    items.push({ label: "View booking", href: `/staff/bookings/${links.bookingId}` });
  }
  if (links?.customerId) {
    items.push({
      label: "View customer profile",
      href: `/staff/customers/${links.customerId}`,
    });
  }
  if (links?.vehicleId) {
    items.push({
      label: "View asset details",
      href: `/staff/fleet/vehicles/${links.vehicleId}`,
    });
  }
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1">
          View
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
