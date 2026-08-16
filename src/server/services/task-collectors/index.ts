import type { StaffTaskType } from "@prisma/client";
import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { VirtualTask } from "@/lib/tasks/types";
import { compareVirtualTasks } from "@/lib/tasks/tiers";
import { logger } from "@/lib/logger";
import { collectBookingTasks, type CollectorOpts } from "./bookings";
import { collectInspectionTasks } from "./inspections";
import { collectWorkOrderTasks } from "./work-orders";
import { collectAgreementTasks } from "./agreements";
import { collectReturnAssessmentTasks } from "./returns";
import { collectIncidentTasks } from "./incidents";

export type { CollectorOpts } from "./bookings";

type Collector = (db: PrismaLike, opts: CollectorOpts) => Promise<VirtualTask[]>;

/**
 * Every Phase 1 collector. Each collector provides the task types it emits
 * so `collectAllTasks` can skip collectors the caller has filtered out.
 */
export const COLLECTORS: ReadonlyArray<{
  key: string;
  types: StaffTaskType[];
  run: Collector;
}> = [
  {
    key: "bookings",
    types: ["BOOKING_PICKUP", "BOOKING_RETURN", "BOOKING_OVERDUE_CHASE"],
    run: collectBookingTasks,
  },
  {
    key: "inspections",
    types: ["INSPECTION_PRE_HIRE", "INSPECTION_POST_HIRE"],
    run: collectInspectionTasks,
  },
  {
    key: "work-orders",
    types: ["MAINTENANCE_WORK_ORDER"],
    run: collectWorkOrderTasks,
  },
  {
    key: "agreements",
    types: ["RENTAL_AGREEMENT_SIGN"],
    run: collectAgreementTasks,
  },
  {
    key: "returns",
    types: ["RETURN_ASSESSMENT_FINALISE"],
    run: collectReturnAssessmentTasks,
  },
  {
    key: "incidents",
    types: ["INCIDENT_INVESTIGATE"],
    run: collectIncidentTasks,
  },
];

export interface CollectAllOpts extends CollectorOpts {
  typeFilter?: StaffTaskType[] | null;
  budgetMs?: number;
}

/**
 * Fan-out across every collector, with a per-collector try/catch and a
 * global budget (default 500ms). Collectors that time out or throw are
 * logged and their tasks dropped from this call — the UI degrades rather
 * than hangs.
 */
export async function collectAllTasks(
  db: PrismaLike,
  opts: CollectAllOpts = {},
): Promise<{ tasks: VirtualTask[]; failed: string[] }> {
  const budgetMs = opts.budgetMs ?? 500;
  const filter = opts.typeFilter && opts.typeFilter.length > 0 ? new Set(opts.typeFilter) : null;
  const active = COLLECTORS.filter((c) => !filter || c.types.some((t) => filter.has(t)));

  const failed: string[] = [];
  const results = await Promise.all(
    active.map(async (collector) => {
      try {
        return await Promise.race([
          collector.run(db, opts),
          new Promise<VirtualTask[]>((_, reject) =>
            setTimeout(() => reject(new Error(`collector ${collector.key} timeout`)), budgetMs),
          ),
        ]);
      } catch (err) {
        failed.push(collector.key);
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ collector: collector.key, err: msg }, "staff-tasks collector failed");
        return [] as VirtualTask[];
      }
    }),
  );

  const tasks = results
    .flat()
    .filter((t) => (filter ? filter.has(t.taskType) : true))
    .sort(compareVirtualTasks);
  return { tasks, failed };
}
