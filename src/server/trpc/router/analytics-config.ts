import { z } from "zod";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  managerProcedure,
  staffProcedure,
} from "../trpc";
import {
  ALERT_METRICS,
  ALERT_OPERATORS,
  ALERT_SCHEMA,
  FUNNEL_STEPS_SCHEMA,
  SEGMENT_FILTER_SCHEMA,
  type FunnelStep,
} from "@/lib/analytics/segments";
import { evaluateAlertMetric } from "@/server/services/analytics-alert";

/**
 * CRUD + evaluators for the saved-segment / custom-funnel / alert
 * models from Slice 6. Split out of `live-analytics.ts` so that file
 * stays focused on the analytics query layer — this one is the
 * configuration surface.
 */

const RANGE_DAYS = { TODAY: 1, "7D": 7, "30D": 30, "90D": 90 } as const;

function rangeBounds(range: keyof typeof RANGE_DAYS): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  if (range === "TODAY") from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - RANGE_DAYS[range]);
  return { from, to };
}

function whereFromFilter(filter: z.infer<typeof SEGMENT_FILTER_SCHEMA>): Prisma.VisitorSessionWhereInput {
  const where: Prisma.VisitorSessionWhereInput = {};
  if (filter.country) where.country = filter.country;
  if (filter.landingPath) where.landingPath = filter.landingPath;
  if (filter.utmSource) where.utmSource = filter.utmSource;
  if (filter.utmMedium) where.utmMedium = filter.utmMedium;
  if (filter.utmCampaign) where.utmCampaign = filter.utmCampaign;
  if (filter.referrerDomain) where.referrer = filter.referrerDomain;
  if (filter.wizardStepEq != null) where.wizardHighestStep = filter.wizardStepEq;
  if (filter.pickupDepotId) where.pickupDepotId = filter.pickupDepotId;
  if (filter.categoryId) where.categoryId = filter.categoryId;
  if (filter.vehicleId) where.vehicleId = filter.vehicleId;
  if (filter.discountCode) where.discountCode = filter.discountCode;
  if (filter.segment === "MOBILE") where.deviceType = "MOBILE";
  else if (filter.segment === "DESKTOP") where.deviceType = "DESKTOP";
  else if (filter.segment === "TABLET") where.deviceType = "TABLET";
  else if (filter.segment === "BOT_EXCL") where.deviceType = { not: "BOT" };
  return where;
}

export const analyticsConfigRouter = createTRPCRouter({
  // ---------------------------------------------------------------
  // Segments
  // ---------------------------------------------------------------

  segmentsList: staffProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.analyticsSegment.findMany({
      where: { OR: [{ isShared: true }, { createdBy: ctx.user.id }] },
      orderBy: { createdAt: "desc" },
      include: { creator: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      filter: r.filter as z.infer<typeof SEGMENT_FILTER_SCHEMA>,
      isShared: r.isShared,
      createdBy: r.createdBy,
      createdByName: [r.creator.firstName, r.creator.lastName].filter(Boolean).join(" ") || null,
      mine: r.createdBy === ctx.user.id,
      createdAt: r.createdAt,
    }));
  }),

  segmentCreate: staffProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        filter: SEGMENT_FILTER_SCHEMA,
        isShared: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.analyticsSegment.create({
        data: {
          name: input.name,
          filter: input.filter as Prisma.InputJsonValue,
          isShared: input.isShared,
          createdBy: ctx.user.id,
        },
      });
      return { id: row.id };
    }),

  segmentDelete: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.analyticsSegment.findUnique({
        where: { id: input.id },
        select: { createdBy: true },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      // Creators can delete their own; managers can delete any.
      const canDelete = row.createdBy === ctx.user.id || ctx.user.role === "MANAGER" || ctx.user.role === "ADMIN" || ctx.user.role === "SUPER_ADMIN";
      if (!canDelete) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.prisma.analyticsSegment.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),

  // ---------------------------------------------------------------
  // Funnels
  // ---------------------------------------------------------------

  funnelsList: staffProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.analyticsFunnel.findMany({
      where: { OR: [{ isShared: true }, { createdBy: ctx.user.id }] },
      orderBy: { createdAt: "desc" },
      include: { creator: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      steps: r.steps as FunnelStep[],
      isShared: r.isShared,
      createdBy: r.createdBy,
      createdByName: [r.creator.firstName, r.creator.lastName].filter(Boolean).join(" ") || null,
      mine: r.createdBy === ctx.user.id,
      createdAt: r.createdAt,
    }));
  }),

  funnelCreate: staffProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(200).optional(),
        steps: FUNNEL_STEPS_SCHEMA,
        isShared: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.analyticsFunnel.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          steps: input.steps as Prisma.InputJsonValue,
          isShared: input.isShared,
          createdBy: ctx.user.id,
        },
      });
      return { id: row.id };
    }),

  funnelDelete: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.analyticsFunnel.findUnique({
        where: { id: input.id },
        select: { createdBy: true },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const canDelete = row.createdBy === ctx.user.id || ctx.user.role === "MANAGER" || ctx.user.role === "ADMIN" || ctx.user.role === "SUPER_ADMIN";
      if (!canDelete) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.prisma.analyticsFunnel.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),

  /**
   * Evaluate a custom funnel: for each step (in order), count the
   * sessions that reached that step. A session "reaches" a step if it
   * has satisfied every prior step AND the current step. We do this
   * by progressively shrinking a candidate `sessionId` set.
   */
  funnelEvaluate: staffProcedure
    .input(
      z.object({
        funnelId: z.string(),
        range: z.enum(["TODAY", "7D", "30D", "90D"]).default("7D"),
        segment: SEGMENT_FILTER_SCHEMA.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const funnel = await ctx.prisma.analyticsFunnel.findUnique({
        where: { id: input.funnelId },
      });
      if (!funnel) throw new TRPCError({ code: "NOT_FOUND" });
      const steps = funnel.steps as FunnelStep[];
      const { from, to } = rangeBounds(input.range);
      const segmentWhere = input.segment ? whereFromFilter(input.segment) : {};

      // Seed: all sessions in the window matching the optional segment.
      const seedSessions = await ctx.prisma.visitorSession.findMany({
        where: { startedAt: { gte: from, lte: to }, ...segmentWhere },
        select: { id: true },
      });
      let candidateIds = new Set(seedSessions.map((s) => s.id));
      const perStep: Array<{ step: number; label: string; reached: number; dropOffRate: number | null }> = [];
      let prevReached = candidateIds.size;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        if (candidateIds.size === 0) {
          perStep.push({
            step: i + 1,
            label: step.label,
            reached: 0,
            dropOffRate: prevReached > 0 ? 1 : null,
          });
          prevReached = 0;
          continue;
        }
        const matchingIds = await matchStepSessions(
          ctx.prisma,
          step,
          Array.from(candidateIds),
          from,
          to,
        );
        const survived = new Set(matchingIds);
        candidateIds = survived;
        const reached = survived.size;
        const dropOffRate = prevReached > 0 ? Math.max(0, 1 - reached / prevReached) : null;
        perStep.push({ step: i + 1, label: step.label, reached, dropOffRate });
        prevReached = reached;
      }

      return {
        funnelId: funnel.id,
        name: funnel.name,
        description: funnel.description,
        startingSessions: seedSessions.length,
        steps: perStep,
      };
    }),

  // ---------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------

  alertsList: staffProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.analyticsAlert.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      include: { creator: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      metric: r.metric,
      operator: r.operator,
      threshold: r.threshold,
      notifyEmails: r.notifyEmails as string[],
      cooldownMinutes: r.cooldownMinutes,
      isActive: r.isActive,
      lastFiredAt: r.lastFiredAt,
      lastValue: r.lastValue,
      lastCheckedAt: r.lastCheckedAt,
      createdByName: [r.creator.firstName, r.creator.lastName].filter(Boolean).join(" ") || null,
    }));
  }),

  alertCreate: managerProcedure
    .input(ALERT_SCHEMA)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.analyticsAlert.create({
        data: {
          name: input.name,
          metric: input.metric,
          operator: input.operator,
          threshold: input.threshold,
          notifyEmails: input.notifyEmails as Prisma.InputJsonValue,
          cooldownMinutes: input.cooldownMinutes,
          isActive: input.isActive,
          createdBy: ctx.user.id,
        },
      });
      return { id: row.id };
    }),

  alertUpdate: managerProcedure
    .input(
      ALERT_SCHEMA.partial().extend({ id: z.string() }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, notifyEmails, ...patch } = input;
      await ctx.prisma.analyticsAlert.update({
        where: { id },
        data: {
          ...patch,
          ...(notifyEmails !== undefined
            ? { notifyEmails: notifyEmails as Prisma.InputJsonValue }
            : {}),
        },
      });
      return { ok: true as const };
    }),

  alertDelete: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.analyticsAlert.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),

  /**
   * One-shot evaluator — returns the current observed value for a
   * given metric without writing anywhere. Useful for the "preview"
   * panel on the alert create form so staff can sanity-check their
   * threshold before saving.
   */
  alertPreview: staffProcedure
    .input(z.object({ metric: z.enum(ALERT_METRICS) }))
    .query(async ({ ctx, input }) => {
      const value = await evaluateAlertMetric(ctx.prisma, input.metric);
      return { metric: input.metric, value };
    }),
});

/**
 * Helper for funnelEvaluate — given a step and a set of candidate
 * session IDs, return which survived this step. Each step type is
 * implemented as a single query scoped to the candidate set so the
 * evaluation stays O(steps) round-trips.
 */
async function matchStepSessions(
  prisma: import("@prisma/client").PrismaClient,
  step: FunnelStep,
  candidateIds: string[],
  from: Date,
  to: Date,
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  if (step.kind === "outcome") {
    const rows = await prisma.visitorSession.findMany({
      where: { id: { in: candidateIds }, outcome: step.outcome },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  if (step.kind === "wizardStep") {
    const rows = await prisma.visitorSession.findMany({
      where: { id: { in: candidateIds }, wizardHighestStep: { gte: step.minStep } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  if (step.kind === "path") {
    const pathFilter: Prisma.VisitorPageViewWhereInput = step.match.endsWith("*")
      ? { path: { startsWith: step.match.slice(0, -1) } }
      : { path: step.match };
    const rows = await prisma.visitorPageView.findMany({
      where: {
        sessionId: { in: candidateIds },
        enteredAt: { gte: from, lte: to },
        ...pathFilter,
      },
      select: { sessionId: true },
      distinct: ["sessionId"],
    });
    return rows.map((r) => r.sessionId);
  }
  // event
  const rows = await prisma.visitorEvent.findMany({
    where: {
      sessionId: { in: candidateIds },
      kind: step.eventKind,
      occurredAt: { gte: from, lte: to },
      ...(step.target ? { target: step.target } : {}),
    },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  return rows.map((r) => r.sessionId);
}

export { ALERT_OPERATORS };
