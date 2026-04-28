"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StaffTaskType } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DataTableSortState } from "@/components/ui/data-table";
import { ResumeBanner } from "./resume-banner";
import { AbandonDialog } from "./abandon-dialog";
import { QueueTab } from "./queue-tab";
import {
  HistoryTab,
  type HistoryRangePreset,
  type HistoryStatusFilter,
} from "./history-tab";

const TABS = ["queue", "history"] as const;
type TabValue = (typeof TABS)[number];

const TIERS = ["ALL", "URGENT", "HIGH", "MEDIUM", "LOW"] as const;
type TierFilter = (typeof TIERS)[number];

const HISTORY_RANGES: readonly HistoryRangePreset[] = ["24h", "7d", "30d", "90d"];
const HISTORY_STATUSES: readonly HistoryStatusFilter[] = [
  "ALL",
  "COMPLETED",
  "ABANDONED",
  "SUPERSEDED",
];
const HISTORY_SORT_IDS = ["completedAt", "workSec", "cycleSec", "staff", "type"] as const;

const DEFAULT_QUEUE_PAGE_SIZE = 25;
const DEFAULT_HISTORY_PAGE_SIZE = 25;

function parseTab(value: string | null): TabValue {
  return (TABS as readonly string[]).includes(value ?? "") ? (value as TabValue) : "queue";
}

function parseTier(value: string | null): TierFilter {
  return (TIERS as readonly string[]).includes(value ?? "") ? (value as TierFilter) : "ALL";
}

function parseRange(value: string | null): HistoryRangePreset {
  return (HISTORY_RANGES as readonly string[]).includes(value ?? "")
    ? (value as HistoryRangePreset)
    : "7d";
}

function parseHistoryStatus(value: string | null): HistoryStatusFilter {
  return (HISTORY_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as HistoryStatusFilter)
    : "ALL";
}

function parsePageSize(value: string | null, fallback: number): number {
  const n = Number(value);
  return [25, 50, 100].includes(n) ? n : fallback;
}

function parseSort(value: string | null): DataTableSortState | null {
  if (!value) return null;
  const [id, dir] = value.split(":");
  if (!id || (dir !== "asc" && dir !== "desc")) return null;
  if (!(HISTORY_SORT_IDS as readonly string[]).includes(id)) return null;
  return { id, dir };
}

export function TasksClient({ depotId }: { depotId: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tab = parseTab(searchParams.get("tab"));
  const tier = parseTier(searchParams.get("tier"));
  const onlyMine = searchParams.get("mine") === "1";
  const queuePage = Math.max(1, Number(searchParams.get("qp")) || 1);
  const queuePageSize = parsePageSize(searchParams.get("qs"), DEFAULT_QUEUE_PAGE_SIZE);

  const range = parseRange(searchParams.get("range"));
  const historyStatus = parseHistoryStatus(searchParams.get("status"));
  const historyTaskType = (searchParams.get("type") ?? "ALL") as StaffTaskType | "ALL";
  const search = searchParams.get("q") ?? "";
  const historyPage = Math.max(1, Number(searchParams.get("hp")) || 1);
  const historyPageSize = parsePageSize(searchParams.get("hs"), DEFAULT_HISTORY_PAGE_SIZE);
  const sort = parseSort(searchParams.get("sort"));

  const setParams = React.useCallback(
    (patch: Record<string, string | number | boolean | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === undefined) next.delete(key);
        else if (typeof value === "boolean") {
          if (value) next.set(key, "1");
          else next.delete(key);
        } else next.set(key, String(value));
      }
      router.replace(`/staff/tasks?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const activeQuery = trpc.staffTask.myActive.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const utils = trpc.useUtils();
  const continueMut = trpc.staffTask.continue.useMutation({
    onSuccess: (res) => router.push(res.redirectUrl),
  });
  const complete = trpc.staffTask.complete.useMutation({
    onSuccess: () => {
      utils.staffTask.list.invalidate();
      utils.staffTask.myActive.invalidate();
      utils.staffTask.history.invalidate();
    },
  });
  const abandon = trpc.staffTask.abandon.useMutation({
    onSuccess: () => {
      utils.staffTask.list.invalidate();
      utils.staffTask.myActive.invalidate();
      utils.staffTask.history.invalidate();
    },
  });

  const [abandonTarget, setAbandonTarget] = React.useState<string | null>(null);

  return (
    <>
      {activeQuery.data && activeQuery.data.length > 0 ? (
        <ResumeBanner
          activities={activeQuery.data}
          onContinue={(activityId, actionUrl) =>
            continueMut.mutate({ activityId, actionUrl })
          }
          onComplete={(activityId) => complete.mutate({ activityId })}
          onAbandon={(activityId) => setAbandonTarget(activityId)}
        />
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(next) =>
          setParams({ tab: next === "queue" ? null : next })
        }
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent
          value="queue"
          className="mt-0 flex min-h-0 flex-1 flex-col gap-4 data-[state=inactive]:hidden"
          forceMount
        >
          <QueueTab
            depotId={depotId}
            tierFilter={tier}
            onlyMine={onlyMine}
            page={queuePage}
            pageSize={queuePageSize}
            onTierFilterChange={(next) =>
              setParams({ tier: next === "ALL" ? null : next, qp: null })
            }
            onOnlyMineChange={(next) => setParams({ mine: next, qp: null })}
            onPageChange={(next) => setParams({ qp: next === 1 ? null : next })}
            onPageSizeChange={(next) =>
              setParams({ qs: next === DEFAULT_QUEUE_PAGE_SIZE ? null : next, qp: null })
            }
          />
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-0 flex min-h-0 flex-1 flex-col gap-4 data-[state=inactive]:hidden"
          forceMount
        >
          <HistoryTab
            range={range}
            status={historyStatus}
            taskType={historyTaskType}
            search={search}
            page={historyPage}
            pageSize={historyPageSize}
            sort={sort}
            onRangeChange={(next) =>
              setParams({ range: next === "7d" ? null : next, hp: null })
            }
            onStatusChange={(next) =>
              setParams({ status: next === "ALL" ? null : next, hp: null })
            }
            onTaskTypeChange={(next) =>
              setParams({ type: next === "ALL" ? null : next, hp: null })
            }
            onSearchChange={(next) => setParams({ q: next || null, hp: null })}
            onPageChange={(next) => setParams({ hp: next === 1 ? null : next })}
            onPageSizeChange={(next) =>
              setParams({ hs: next === DEFAULT_HISTORY_PAGE_SIZE ? null : next, hp: null })
            }
            onSortChange={(next) =>
              setParams({ sort: next ? `${next.id}:${next.dir}` : null, hp: null })
            }
          />
        </TabsContent>
      </Tabs>

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
