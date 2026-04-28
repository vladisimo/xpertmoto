import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "subscription-billing" as const;

/**
 * Lever 3 — recurring subscription billing roll-over.
 *
 * Hourly sweep that finds subscriptions whose `currentPeriodEnd` has
 * passed and rolls them forward by one month. For each rollover we:
 *   1. Close the current-period `SubscriptionUsage` row (create one if
 *      none exists) so admin reporting has a complete history.
 *   2. Compute overage charges from days-used beyond `plan.includedDays`
 *      and km-used beyond `plan.includedKm`, if the plan caps either.
 *   3. Advance `currentPeriodStart/End` by one month; leave
 *      `usageSnapshot` empty so the next period accumulates fresh.
 *   4. Notify the customer if there were overage charges.
 *
 * Actual Stripe subscription billing is out of scope here — this job
 * maintains the local ledger. When a Stripe integration arrives the
 * subscription's `stripeSubscriptionId` is honored (the Stripe webhook
 * flows period transitions) and this job becomes a no-op for those
 * subscriptions.
 */

export interface SubscriptionBillingResult {
  rolled: number;
  overages: number;
  notified: number;
}

export function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
}

export function computeDaysUsed(snapshot: unknown): number {
  if (snapshot && typeof snapshot === "object" && "daysUsed" in snapshot) {
    const v = (snapshot as { daysUsed?: unknown }).daysUsed;
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  }
  return 0;
}

export function computeKmUsed(snapshot: unknown): number {
  if (snapshot && typeof snapshot === "object" && "kmUsed" in snapshot) {
    const v = (snapshot as { kmUsed?: unknown }).kmUsed;
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  }
  return 0;
}

/**
 * Pure overage calculation — extracted for testability.
 * Returns dollars owed for going over includedDays or includedKm.
 */
export function computeOverage(opts: {
  daysUsed: number;
  kmUsed: number;
  includedDays: number | null;
  includedKm: number | null;
  overageDayRate: number | null;
  overageKmRate: number | null;
}): { overageDays: number; overageKm: number; overageCharge: number } {
  const overageDays = opts.includedDays ? Math.max(0, opts.daysUsed - opts.includedDays) : 0;
  const overageKm = opts.includedKm ? Math.max(0, opts.kmUsed - opts.includedKm) : 0;
  const dayRate = opts.overageDayRate ?? 0;
  const kmRate = opts.overageKmRate ?? 0;
  const overageCharge =
    Math.round((overageDays * dayRate + overageKm * kmRate) * 100) / 100;
  return { overageDays, overageKm, overageCharge };
}

export async function runSubscriptionBilling(
  now: Date = new Date(),
): Promise<SubscriptionBillingResult> {
  const counters: SubscriptionBillingResult = { rolled: 0, overages: 0, notified: 0 };

  const due = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
      currentPeriodEnd: { lt: now },
      // Stripe-managed subscriptions get their periods rolled by webhooks.
      stripeSubscriptionId: null,
    },
    include: { plan: true, customer: true },
  });

  for (const sub of due) {
    try {
      const daysUsed = computeDaysUsed(sub.usageSnapshot);
      const kmUsed = computeKmUsed(sub.usageSnapshot);
      const { overageDays, overageKm, overageCharge } = computeOverage({
        daysUsed,
        kmUsed,
        includedDays: sub.plan.includedDays,
        includedKm: sub.plan.includedKm,
        overageDayRate: sub.plan.overageDayRate == null ? null : Number(sub.plan.overageDayRate),
        overageKmRate: sub.plan.overageKmRate == null ? null : Number(sub.plan.overageKmRate),
      });

      const nextStart = sub.currentPeriodEnd;
      const nextEnd = addOneMonth(nextStart);

      await prisma.$transaction(async (tx) => {
        // Close the current-period usage row (create if absent).
        await tx.subscriptionUsage.upsert({
          where: {
            subscriptionId_periodStart: {
              subscriptionId: sub.id,
              periodStart: sub.currentPeriodStart,
            },
          },
          update: {
            daysUsed,
            kmUsed,
            overageCharge: new Decimal(overageCharge),
          },
          create: {
            subscriptionId: sub.id,
            periodStart: sub.currentPeriodStart,
            periodEnd: sub.currentPeriodEnd,
            daysUsed,
            kmUsed,
            swapsUsed: 0,
            overageCharge: new Decimal(overageCharge),
          },
        });
        // Roll the subscription forward.
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            currentPeriodStart: nextStart,
            currentPeriodEnd: nextEnd,
            usageSnapshot: {},
            // If it was PAST_DUE, reset to ACTIVE now that a new period
            // has opened. Stripe-managed rows would handle this upstream.
            status: sub.status === "PAST_DUE" ? "ACTIVE" : sub.status,
          },
        });
      });

      counters.rolled += 1;

      if (overageCharge > 0) {
        counters.overages += 1;
        await sendNotification({
          userId: sub.customerId,
          type: "SUBSCRIPTION_RENEWED",
          channels: ["EMAIL"],
          subject: `Subscription overage — ${sub.plan.name}`,
          title: "Subscription overage charge",
          body:
            `Hi ${sub.customer.firstName},\n\n` +
            `Your ${sub.plan.name} subscription rolled over on ${nextStart.toLocaleDateString("en-AU")}. ` +
            `You went over the included allowance by ${overageDays} day(s) and ${overageKm} km, ` +
            `totalling $${overageCharge.toFixed(2)}.\n\n` +
            `This has been added to your account.`,
          data: { subscriptionId: sub.id, overageCharge, overageDays, overageKm },
        }).catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), subscriptionId: sub.id },
            "subscription-billing: notification failed",
          );
        });
        counters.notified += 1;
      }
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          subscriptionId: sub.id,
        },
        "subscription-billing: rollover failed",
      );
    }
  }

  logger.info(counters, "subscription-billing finished");
  return counters;
}

export function startSubscriptionBillingScheduler() {
  registerWorker(QUEUE, async () => runSubscriptionBilling());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Hourly on the 10-minute offset — avoids colliding with overdue-check
  // at :00/:15/:30/:45 and pending-payment-ttl.
  q.add(
    "hourly",
    {},
    { repeat: { pattern: "10 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-hourly-subscription-billing" },
  );
}
