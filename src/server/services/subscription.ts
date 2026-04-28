import type { PrismaClient } from "@prisma/client";

/**
 * Lever 3: subscription lifecycle helpers.
 *
 * Represents a recurring monthly product (e.g. "Courier 125cc Unlimited").
 * A Subscription attaches to a customer OR a BusinessAccount and
 * replaces ad-hoc bookings. Bookings made against the subscription
 * consume `includedDays` / `includedKm` quota; overage is billed at
 * period end.
 *
 * Stripe integration: the plans set up as Stripe Products; Subscription
 * rows mirror Stripe Subscription state. This service keeps the
 * cashflow-critical logic (usage tracking, overage calc) pure so it
 * tests without Stripe.
 */

export type SubscriptionUsageDelta = {
  daysUsed?: number;
  kmUsed?: number;
  swapsUsed?: number;
};

export async function recordSubscriptionUsage(
  prisma: PrismaClient,
  subscriptionId: string,
  delta: SubscriptionUsageDelta,
): Promise<void> {
  const sub = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
  });
  await prisma.subscriptionUsage.upsert({
    where: {
      subscriptionId_periodStart: {
        subscriptionId: sub.id,
        periodStart: sub.currentPeriodStart,
      },
    },
    update: {
      daysUsed: { increment: delta.daysUsed ?? 0 },
      kmUsed: { increment: delta.kmUsed ?? 0 },
      swapsUsed: { increment: delta.swapsUsed ?? 0 },
    },
    create: {
      subscriptionId: sub.id,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      daysUsed: delta.daysUsed ?? 0,
      kmUsed: delta.kmUsed ?? 0,
      swapsUsed: delta.swapsUsed ?? 0,
    },
  });
}

export type OverageQuote = {
  daysOver: number;
  kmOver: number;
  overageCharge: number;
};

export async function computeOverage(
  prisma: PrismaClient,
  subscriptionId: string,
): Promise<OverageQuote> {
  const sub = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    include: { plan: true },
  });
  const usage = await prisma.subscriptionUsage.findUnique({
    where: {
      subscriptionId_periodStart: {
        subscriptionId: sub.id,
        periodStart: sub.currentPeriodStart,
      },
    },
  });
  if (!usage) return { daysOver: 0, kmOver: 0, overageCharge: 0 };
  const plan = sub.plan;
  const daysOver = plan.includedDays
    ? Math.max(0, usage.daysUsed - plan.includedDays)
    : 0;
  const kmOver = plan.includedKm
    ? Math.max(0, usage.kmUsed - plan.includedKm)
    : 0;
  const dayRate = plan.overageDayRate ? Number(plan.overageDayRate) : 0;
  const kmRate = plan.overageKmRate ? Number(plan.overageKmRate) : 0;
  const overageCharge =
    Math.round((daysOver * dayRate + kmOver * kmRate) * 100) / 100;
  return { daysOver, kmOver, overageCharge };
}

export async function advancePeriod(
  prisma: PrismaClient,
  subscriptionId: string,
): Promise<void> {
  const sub = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
  });
  const nextStart = new Date(sub.currentPeriodEnd);
  const nextEnd = new Date(nextStart);
  nextEnd.setMonth(nextEnd.getMonth() + 1);
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      currentPeriodStart: nextStart,
      currentPeriodEnd: nextEnd,
      usageSnapshot: {},
    },
  });
}
