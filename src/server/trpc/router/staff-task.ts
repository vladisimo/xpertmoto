import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma, StaffTaskType } from "@prisma/client";
import {
  createTRPCRouter,
  staffProcedure,
  adminProcedure,
} from "../trpc";
import { collectAllTasks } from "@/server/services/task-collectors";
import {
  abandonTask,
  claimTask,
  heartbeat as heartbeatService,
  manualComplete,
} from "@/server/services/staff-tasks";
import { encodeTaskId, type TaskListEntry } from "@/lib/tasks/types";
import { PHASE_1_TASK_TYPES } from "@/lib/tasks/tiers";
import {
  emptyBucket,
  emptyTimingBucket,
  recordRow,
  recordRowWithTimings,
  summariseBucket,
  summariseBucketWithTimings,
  upsertBucket,
} from "@/lib/tasks/metrics";
import { compareHistoryRows, enrichHistoryRow } from "@/lib/tasks/history";

const STAFF_TASK_TYPE = z.enum([
  "BOOKING_PICKUP",
  "BOOKING_RETURN",
  "BOOKING_OVERDUE_CHASE",
  "INSPECTION_PRE_HIRE",
  "INSPECTION_POST_HIRE",
  "INSPECTION_FLAGGED_REVIEW",
  "MAINTENANCE_WORK_ORDER",
  "VEHICLE_REGO_ACTION",
  "VEHICLE_CTP_ACTION",
  "VEHICLE_INSURANCE_ACTION",
  "VEHICLE_SERVICE_ACTION",
  "VEHICLE_TYRE_ACTION",
  "INCIDENT_TRIAGE",
  "INCIDENT_INVESTIGATE",
  "SUPPORT_TICKET_TRIAGE",
  "SUPPORT_TICKET_RESPOND",
  "CUSTOMER_LICENCE_VERIFY",
  "RENTAL_AGREEMENT_SIGN",
  "RETURN_ASSESSMENT_FINALISE",
  "CALENDAR_ALLOCATION",
  "DAMAGE_CHARGE_CONFIRM",
  "INFRINGEMENT_NOMINATE",
  "BOND_RELEASE_REVIEW",
]);

const STAFF_TASK_TIER = z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]);

const STAFF_TASK_STATUS = z.enum([
  "IN_PROGRESS",
  "COMPLETED",
  "ABANDONED",
  "SUPERSEDED",
]);

const HISTORY_SORT = z.enum(["completedAt", "workSec", "cycleSec", "staff", "type"]);

const HISTORY_DEFAULT_STATUSES: Prisma.EnumStaffTaskActivityStatusFilter["in"] = [
  "COMPLETED",
  "ABANDONED",
  "SUPERSEDED",
];

export const staffTaskRouter = createTRPCRouter({
  list: staffProcedure
    .input(
      z.object({
        depotId: z.string().optional(),
        types: z.array(STAFF_TASK_TYPE).optional(),
        tiers: z.array(STAFF_TASK_TIER).optional(),
        onlyMine: z.boolean().default(false),
        limit: z.number().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const depotId = input.depotId ?? ctx.session.user.depotId ?? null;
      const typeFilter =
        input.types && input.types.length > 0
          ? (input.types as StaffTaskType[])
          : (PHASE_1_TASK_TYPES as StaffTaskType[]);
      const { tasks, failed } = await collectAllTasks(ctx.prisma, {
        depotId: depotId ?? undefined,
        typeFilter,
        limit: input.limit,
      });

      const orSpec = tasks.map((t) => ({
        taskType: t.taskType,
        targetEntityId: t.targetEntityId,
      }));
      const inProgress =
        orSpec.length > 0
          ? await ctx.prisma.staffTaskActivity.findMany({
              where: {
                status: "IN_PROGRESS",
                OR: orSpec,
              },
              select: {
                id: true,
                taskType: true,
                targetEntityId: true,
                staffId: true,
                startedAt: true,
                staff: { select: { firstName: true, lastName: true } },
              },
            })
          : [];
      const byKey = new Map<string, (typeof inProgress)[number]>();
      for (const a of inProgress) byKey.set(`${a.taskType}:${a.targetEntityId}`, a);

      const now = new Date();
      const entries: TaskListEntry[] = tasks.map((t) => {
        const composedId = encodeTaskId(t.taskType, t.targetEntityId);
        const active = byKey.get(composedId);
        return {
          ...t,
          composedId,
          ageSeconds: Math.max(0, Math.round((now.getTime() - t.actionableSince.getTime()) / 1000)),
          inProgress: active
            ? {
                activityId: active.id,
                staffId: active.staffId,
                staffName: `${active.staff.firstName} ${active.staff.lastName}`,
                startedAt: active.startedAt,
                isMine: active.staffId === ctx.session.user.id,
              }
            : null,
        };
      });

      const filtered = entries
        .filter((e) => (input.tiers && input.tiers.length > 0 ? input.tiers.includes(e.tier) : true))
        .filter((e) => (input.onlyMine ? e.inProgress?.isMine === true : true));

      // In-progress tasks float to the top — staff don't want to hunt for
      // work they've already commenced. Within "in progress" we put MY
      // claims above other people's, oldest-first (longest-running first).
      // The unclaimed tail keeps the collector order (tier, oldest-first).
      const inProgressGroup = filtered.filter((e) => e.inProgress);
      const unclaimedGroup = filtered.filter((e) => !e.inProgress);
      inProgressGroup.sort((a, b) => {
        const mineA = a.inProgress!.isMine ? 0 : 1;
        const mineB = b.inProgress!.isMine ? 0 : 1;
        if (mineA !== mineB) return mineA - mineB;
        return a.inProgress!.startedAt.getTime() - b.inProgress!.startedAt.getTime();
      });

      return {
        tasks: [...inProgressGroup, ...unclaimedGroup],
        degraded: failed.length > 0,
        failedCollectors: failed,
      };
    }),

  myActive: staffProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.staffTaskActivity.findMany({
      where: { staffId: ctx.session.user.id, status: "IN_PROGRESS" },
      orderBy: { startedAt: "asc" },
    });
    return rows;
  }),

  start: staffProcedure
    .input(
      z.object({
        taskType: STAFF_TASK_TYPE,
        targetEntityId: z.string(),
        tier: STAFF_TASK_TIER,
        targetEntityKind: z.string(),
        actionUrl: z.string(),
        depotId: z.string().nullable().optional(),
        /**
         * Opaque denormalised context from the collector (e.g. bookingId for an
         * inspection task) so Resume can deep-link back to the right page
         * without re-querying the domain model.
         */
        metadata: z.record(z.string(), z.unknown()).optional(),
        /** When the collector first reported this task as actionable — so the
         *  history view can compute queue-wait and end-to-end cycle times. */
        actionableSince: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const activity = await claimTask(ctx.prisma, {
        taskType: input.taskType,
        targetEntityKind: input.targetEntityKind as never,
        targetEntityId: input.targetEntityId,
        staffId: ctx.session.user.id,
        depotId: input.depotId ?? ctx.session.user.depotId ?? null,
        tier: input.tier,
        metadata: input.metadata as never,
        actionableSince: input.actionableSince ?? null,
      });
      return { activityId: activity.id, redirectUrl: input.actionUrl };
    }),

  continue: staffProcedure
    .input(z.object({ activityId: z.string(), actionUrl: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const activity = await ctx.prisma.staffTaskActivity.findUnique({
        where: { id: input.activityId },
      });
      if (!activity) throw new TRPCError({ code: "NOT_FOUND" });
      if (activity.staffId !== ctx.session.user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This task is claimed by another staff member.",
        });
      if (activity.status !== "IN_PROGRESS")
        throw new TRPCError({ code: "PRECONDITION_FAILED" });
      await ctx.prisma.staffTaskActivity.update({
        where: { id: activity.id },
        data: { lastHeartbeatAt: new Date() },
      });
      return { redirectUrl: input.actionUrl };
    }),

  complete: staffProcedure
    .input(z.object({ activityId: z.string(), outcomeNote: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return manualComplete(ctx.prisma, input.activityId, ctx.session.user.id, input.outcomeNote);
    }),

  abandon: staffProcedure
    .input(
      z.object({
        activityId: z.string(),
        reason: z.string().min(5, "Please give a reason of at least 5 characters."),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return abandonTask(ctx.prisma, input.activityId, {
        userId: ctx.session.user.id,
        userRole: ctx.session.user.role,
        reason: input.reason,
        force: input.force,
      });
    }),

  heartbeat: staffProcedure
    .input(z.object({ activityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await heartbeatService(ctx.prisma, input.activityId, ctx.session.user.id);
      return { ok };
    }),

  history: staffProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        depotId: z.string().optional(),
        staffId: z.string().optional(),
        taskTypes: z.array(STAFF_TASK_TYPE).optional(),
        statuses: z.array(STAFF_TASK_STATUS).optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        sortBy: HISTORY_SORT.default("completedAt"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Cross-depot visibility is intentional here: any staff member can see
      // team productivity. Depot filter is optional *narrowing*, not scoping.
      const statuses =
        input.statuses && input.statuses.length > 0
          ? input.statuses
          : HISTORY_DEFAULT_STATUSES;
      const where: Prisma.StaffTaskActivityWhereInput = {
        completedAt: { gte: input.from, lt: input.to, not: null },
        status: { in: statuses },
        ...(input.depotId ? { depotId: input.depotId } : {}),
        ...(input.staffId ? { staffId: input.staffId } : {}),
        ...(input.taskTypes && input.taskTypes.length > 0
          ? { taskType: { in: input.taskTypes as StaffTaskType[] } }
          : {}),
        ...(input.search && input.search.trim()
          ? { outcomeNote: { contains: input.search.trim(), mode: "insensitive" } }
          : {}),
      };

      // Pull the full filtered set in one shot for the summary, then slice
      // client-side for the page. History volumes at this scale (single-org,
      // tens of thousands of rows max per year) stay well inside acceptable
      // response budgets, and one query keeps the rollup and row view
      // consistent. If this grows we can split.
      const rows = await ctx.prisma.staffTaskActivity.findMany({
        where,
        select: {
          id: true,
          taskType: true,
          status: true,
          outcome: true,
          outcomeNote: true,
          startedAt: true,
          completedAt: true,
          actionableSinceSnapshot: true,
          staffId: true,
          depotId: true,
          targetEntityKind: true,
          targetEntityId: true,
          tierSnapshot: true,
          staff: { select: { firstName: true, lastName: true } },
        },
      });

      const enriched = rows.map((r) =>
        enrichHistoryRow({
          id: r.id,
          taskType: r.taskType,
          status: r.status,
          outcome: r.outcome,
          outcomeNote: r.outcomeNote,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          actionableSinceSnapshot: r.actionableSinceSnapshot,
          staffId: r.staffId,
          staffFirstName: r.staff.firstName,
          staffLastName: r.staff.lastName,
          depotId: r.depotId,
          targetEntityKind: r.targetEntityKind,
          targetEntityId: r.targetEntityId,
          tierSnapshot: r.tierSnapshot,
        }),
      );

      // Roll up before sort/slice so filters and sort don't mutate aggregates.
      const overall = emptyTimingBucket();
      const byTaskType = new Map<StaffTaskType, ReturnType<typeof emptyTimingBucket>>();
      const byStaff = new Map<
        string,
        ReturnType<typeof emptyTimingBucket> & { staffName: string }
      >();
      for (const r of enriched) {
        recordRowWithTimings(overall, r.status, r.workSec, r.waitSec, r.cycleSec);
        recordRowWithTimings(
          upsertBucket(byTaskType, r.taskType, emptyTimingBucket),
          r.status,
          r.workSec,
          r.waitSec,
          r.cycleSec,
        );
        recordRowWithTimings(
          upsertBucket(byStaff, r.staffId, () => ({
            ...emptyTimingBucket(),
            staffName: r.staffName,
          })),
          r.status,
          r.workSec,
          r.waitSec,
          r.cycleSec,
        );
      }

      const sorted = [...enriched].sort(compareHistoryRows(input.sortBy, input.sortDir));

      const totalCount = sorted.length;
      const pageCount = Math.max(1, Math.ceil(totalCount / input.pageSize));
      const page = Math.min(input.page, pageCount);
      const start = (page - 1) * input.pageSize;
      const items = sorted.slice(start, start + input.pageSize);

      return {
        items,
        totalCount,
        page,
        pageSize: input.pageSize,
        pageCount,
        summary: {
          overall: summariseBucketWithTimings(overall),
          byTaskType: Array.from(byTaskType.entries()).map(([taskType, b]) => ({
            taskType,
            ...summariseBucketWithTimings(b),
          })),
          byStaff: Array.from(byStaff.entries()).map(([staffId, b]) => ({
            staffId,
            staffName: b.staffName,
            ...summariseBucketWithTimings(b),
          })),
        },
      };
    }),

  metrics: adminProcedure
    .meta({ audit: true })
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        depotId: z.string().optional(),
        staffId: z.string().optional(),
        taskType: STAFF_TASK_TYPE.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        completedAt: { gte: input.from, lt: input.to, not: null },
        ...(input.depotId ? { depotId: input.depotId } : {}),
        ...(input.staffId ? { staffId: input.staffId } : {}),
        ...(input.taskType ? { taskType: input.taskType } : {}),
      };
      const rows = await ctx.prisma.staffTaskActivity.findMany({
        where,
        select: {
          id: true,
          taskType: true,
          status: true,
          startedAt: true,
          completedAt: true,
          staffId: true,
          staff: { select: { firstName: true, lastName: true } },
        },
      });

      const byType = new Map<StaffTaskType, ReturnType<typeof emptyBucket>>();
      const byStaff = new Map<
        string,
        ReturnType<typeof emptyBucket> & { staffName: string }
      >();

      for (const r of rows) {
        const durationSec =
          r.completedAt && r.startedAt
            ? Math.max(0, (r.completedAt.getTime() - r.startedAt.getTime()) / 1000)
            : 0;

        recordRow(upsertBucket(byType, r.taskType, emptyBucket), r.status, durationSec);
        recordRow(
          upsertBucket(byStaff, r.staffId, () => ({
            ...emptyBucket(),
            staffName: `${r.staff.firstName} ${r.staff.lastName}`,
          })),
          r.status,
          durationSec,
        );
      }

      return {
        totalRows: rows.length,
        byTaskType: Array.from(byType.entries()).map(([taskType, b]) => ({
          taskType,
          ...summariseBucket(b),
        })),
        byStaff: Array.from(byStaff.entries()).map(([staffId, b]) => ({
          staffId,
          staffName: b.staffName,
          ...summariseBucket(b),
        })),
      };
    }),
});
