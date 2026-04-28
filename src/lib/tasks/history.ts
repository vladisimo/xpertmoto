import type { StaffTaskActivityStatus, StaffTaskType } from "@prisma/client";

export interface HistoryRawRow {
  id: string;
  taskType: StaffTaskType;
  status: StaffTaskActivityStatus;
  outcome: string | null;
  outcomeNote: string | null;
  startedAt: Date;
  completedAt: Date | null;
  actionableSinceSnapshot: Date | null;
  staffId: string;
  staffFirstName: string;
  staffLastName: string;
  depotId: string | null;
  targetEntityKind: string;
  targetEntityId: string;
  tierSnapshot: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
}

export interface EnrichedHistoryRow {
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
  tier: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  /** Claim → close. Zero for still-open rows (history excludes those anyway). */
  workSec: number;
  /** Identified → claim. Null when actionableSinceSnapshot wasn't captured. */
  waitSec: number | null;
  /** Identified → close. Null when actionableSinceSnapshot wasn't captured. */
  cycleSec: number | null;
}

export function enrichHistoryRow(r: HistoryRawRow): EnrichedHistoryRow {
  const workSec =
    r.completedAt && r.startedAt
      ? Math.max(0, (r.completedAt.getTime() - r.startedAt.getTime()) / 1000)
      : 0;
  const waitSec =
    r.actionableSinceSnapshot && r.startedAt
      ? Math.max(0, (r.startedAt.getTime() - r.actionableSinceSnapshot.getTime()) / 1000)
      : null;
  const cycleSec =
    r.actionableSinceSnapshot && r.completedAt
      ? Math.max(0, (r.completedAt.getTime() - r.actionableSinceSnapshot.getTime()) / 1000)
      : null;
  return {
    id: r.id,
    taskType: r.taskType,
    status: r.status,
    outcome: r.outcome,
    outcomeNote: r.outcomeNote,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    actionableSinceSnapshot: r.actionableSinceSnapshot,
    staffId: r.staffId,
    staffName: `${r.staffFirstName} ${r.staffLastName}`,
    depotId: r.depotId,
    targetEntityKind: r.targetEntityKind,
    targetEntityId: r.targetEntityId,
    tier: r.tierSnapshot,
    workSec,
    waitSec,
    cycleSec,
  };
}

export type HistorySortKey = "completedAt" | "workSec" | "cycleSec" | "staff" | "type";

export function compareHistoryRows(
  sortBy: HistorySortKey,
  dir: "asc" | "desc",
): (a: EnrichedHistoryRow, b: EnrichedHistoryRow) => number {
  const factor = dir === "asc" ? 1 : -1;
  return (a, b) => {
    switch (sortBy) {
      case "workSec":
        return (a.workSec - b.workSec) * factor;
      case "cycleSec":
        return ((a.cycleSec ?? -1) - (b.cycleSec ?? -1)) * factor;
      case "staff":
        return a.staffName.localeCompare(b.staffName) * factor;
      case "type":
        return a.taskType.localeCompare(b.taskType) * factor;
      case "completedAt":
      default: {
        const av = a.completedAt?.getTime() ?? 0;
        const bv = b.completedAt?.getTime() ?? 0;
        return (av - bv) * factor;
      }
    }
  };
}
