import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SubscriptionStatus } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../trpc";

/** Status values that block starting a new subscription for the same customer. */
export const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "ACTIVE",
  "TRIALING",
  "PAUSED",
  "PAST_DUE",
];

/** True when the given subscription status blocks starting a new one. */
export function isActiveStatus(status: SubscriptionStatus): boolean {
  return ACTIVE_SUBSCRIPTION_STATUSES.includes(status);
}

/**
 * Policy: can a subscription with this status be cancelled right now?
 * CANCELLED is idempotent (no-op), all others are cancellable.
 */
export function canCancel(status: SubscriptionStatus): boolean {
  return status !== "CANCELLED";
}

/** Policy: pause is allowed only from ACTIVE or TRIALING. */
export function canPause(status: SubscriptionStatus): boolean {
  return status === "ACTIVE" || status === "TRIALING";
}

/** Policy: resume is allowed only from PAUSED. */
export function canResume(status: SubscriptionStatus): boolean {
  return status === "PAUSED";
}

/**
 * Subscription router — manages SubscriptionPlan catalogue (admin) and a
 * customer's own Subscription lifecycle (pause / cancel / usage view).
 * Actual recurring billing is driven by the `subscription-billing` BullMQ
 * scheduler which rolls the period forward and closes a SubscriptionUsage
 * row each cycle.
 */
export const subscriptionRouter = createTRPCRouter({
  // -------- Plan catalogue --------
  /** Public list of active plans — used on the marketing/pricing page. */
  listPlans: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().default(false) }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.subscriptionPlan.findMany({
        where: input?.includeInactive ? {} : { isActive: true },
        orderBy: { priceMonthlyAud: "asc" },
      }),
    ),

  /** Admin: create a plan. */
  createPlan: adminProcedure
    .input(
      z.object({
        code: z.string().min(2),
        name: z.string().min(2),
        description: z.string().optional(),
        categoryIds: z.array(z.string()).default([]),
        priceMonthlyAud: z.number().positive(),
        includedDays: z.number().int().positive().optional(),
        includedKm: z.number().int().positive().optional(),
        overageDayRate: z.number().nonnegative().optional(),
        overageKmRate: z.number().nonnegative().optional(),
        includesInsurance: z.boolean().default(false),
        includesHelmet: z.boolean().default(true),
        maxSwapsPerMonth: z.number().int().min(0).default(4),
        isBusinessPlan: z.boolean().default(false),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.subscriptionPlan.create({ data: input }),
    ),

  /** Admin: update a plan. */
  updatePlan: adminProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          name: z.string().min(2).optional(),
          description: z.string().optional(),
          priceMonthlyAud: z.number().positive().optional(),
          includedDays: z.number().int().positive().nullable().optional(),
          includedKm: z.number().int().positive().nullable().optional(),
          overageDayRate: z.number().nonnegative().nullable().optional(),
          overageKmRate: z.number().nonnegative().nullable().optional(),
          isActive: z.boolean().optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.subscriptionPlan.update({ where: { id: input.id }, data: input.data }),
    ),

  // -------- Customer subscriptions --------
  /** Current user's active subscription (if any) plus latest usage row. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const subscription = await ctx.prisma.subscription.findFirst({
      where: { customerId: ctx.user.id, status: { in: ["ACTIVE", "TRIALING", "PAUSED", "PAST_DUE"] } },
      include: {
        plan: true,
        usages: { orderBy: { periodStart: "desc" }, take: 3 },
      },
      orderBy: { startedAt: "desc" },
    });
    return subscription;
  }),

  /**
   * Subscribe the current user to a plan. No Stripe plumbing here — this
   * creates the DB record with a 1-month period. A real Stripe-subscription
   * integration would come from a later mutation that fills in
   * stripeSubscriptionId after Checkout completes.
   */
  subscribe: protectedProcedure
    .input(z.object({ planId: z.string(), businessAccountId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.subscriptionPlan.findUniqueOrThrow({
        where: { id: input.planId },
      });
      if (!plan.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "Plan is inactive." });

      // Reject a second active subscription for the same customer — keep it
      // simple. Customers must cancel before switching plans.
      const existing = await ctx.prisma.subscription.findFirst({
        where: { customerId: ctx.user.id, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have an active subscription. Cancel it before subscribing to a new plan.",
        });
      }

      const start = new Date();
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      return ctx.prisma.subscription.create({
        data: {
          customerId: ctx.user.id,
          planId: plan.id,
          businessAccountId: input.businessAccountId,
          status: "ACTIVE",
          currentPeriodStart: start,
          currentPeriodEnd: end,
        },
      });
    }),

  /** Pause the current subscription. */
  pause: protectedProcedure
    .input(z.object({ subscriptionId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const sub = await ctx.prisma.subscription.findUniqueOrThrow({
        where: { id: input.subscriptionId },
      });
      if (sub.customerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (!canPause(sub.status))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot pause from status ${sub.status}.`,
        });
      return ctx.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "PAUSED", pausedAt: new Date(), pauseReason: input.reason },
      });
    }),

  /** Resume a paused subscription. Period end is preserved; no refund or extension. */
  resume: protectedProcedure
    .input(z.object({ subscriptionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sub = await ctx.prisma.subscription.findUniqueOrThrow({
        where: { id: input.subscriptionId },
      });
      if (sub.customerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (!canResume(sub.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Subscription is not paused." });
      return ctx.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "ACTIVE", pausedAt: null, pauseReason: null },
      });
    }),

  /** Cancel the current subscription. Allowed immediately; pro-rata refunds are out of scope. */
  cancel: protectedProcedure
    .input(z.object({ subscriptionId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const sub = await ctx.prisma.subscription.findUniqueOrThrow({
        where: { id: input.subscriptionId },
      });
      if (sub.customerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (!canCancel(sub.status)) return sub;
      return ctx.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason },
      });
    }),

  // -------- Admin --------
  /** Admin: list every subscription with its plan + customer. */
  adminList: adminProcedure
    .input(
      z.object({
        status: z.enum(["TRIALING", "ACTIVE", "PAUSED", "CANCELLED", "PAST_DUE"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }).optional(),
    )
    .query(({ ctx, input }) =>
      ctx.prisma.subscription.findMany({
        where: input?.status ? { status: input.status } : undefined,
        include: {
          plan: true,
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { startedAt: "desc" },
        take: input?.limit ?? 100,
      }),
    ),
});
