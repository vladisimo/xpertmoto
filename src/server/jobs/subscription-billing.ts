import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { gstFromInclusive } from "@/lib/money";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "subscription-billing" as const;

/**
 * Lever 3 — recurring subscription billing roll-over.
 *
 * Hourly sweep that finds subscriptions whose `currentPeriodEnd` has
 * passed and rolls them forward by one month. For each rollover we:
 *   1. Close the current-period `SubscriptionUsage` row (create one if
 *      none exists) so admin reporting has a complete history. Usage is
 *      read from the SubscriptionUsage row (the table
 *      `recordSubscriptionUsage` actually writes to), with the legacy
 *      `usageSnapshot` JSON as a fallback.
 *   2. Compute overage charges from days-used beyond `plan.includedDays`
 *      and km-used beyond `plan.includedKm`, if the plan caps either, and
 *      raise them as a PENDING SUBSCRIPTION_CHARGE Payment — collected
 *      off-session by capture-pending-payments (retry/dunning inherited).
 *   3. Raise the NEW period's base fee the same way (ACTIVE/PAST_DUE only —
 *      TRIALING rolls without a base charge).
 *   4. Advance `currentPeriodStart/End` by one month; leave
 *      `usageSnapshot` empty so the next period accumulates fresh.
 *   5. Notify the customer if there were overage charges.
 *
 * Idempotency: charge references are deterministic per period
 * (`SUB-<id>-<n>` / `SUB-OVER-<id>-<n>`, unique constraint), so a re-run
 * that already queued a period's charge skips it instead of double-billing.
 * When a Stripe-Subscription integration arrives, rows with a
 * `stripeSubscriptionId` are skipped here (webhooks own their periods).
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
      // Usage truth lives in the SubscriptionUsage row that
      // recordSubscriptionUsage writes; the legacy usageSnapshot JSON is a
      // fallback only (it was never populated by any live path).
      const usageRow = await prisma.subscriptionUsage.findUnique({
        where: {
          subscriptionId_periodStart: {
            subscriptionId: sub.id,
            periodStart: sub.currentPeriodStart,
          },
        },
        select: { daysUsed: true, kmUsed: true },
      });
      const daysUsed = usageRow?.daysUsed ?? computeDaysUsed(sub.usageSnapshot);
      const kmUsed = usageRow?.kmUsed ?? computeKmUsed(sub.usageSnapshot);
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
      const baseFee = sub.status === "TRIALING" ? 0 : Number(sub.plan.priceMonthlyAud);

      // Period number for deterministic charge references: SUB-<id>-1 was
      // raised at subscribe; each rollover raises the NEXT period.
      const priorBaseCharges = await prisma.payment.count({
        where: { customerId: sub.customerId, reference: { startsWith: `SUB-${sub.id}-` } },
      });
      const periodNumber = priorBaseCharges + 1;

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

        // Bill the closed period's overage — PENDING row picked up by the
        // off-session capture sweep. Deterministic reference makes re-runs
        // collide (P2002) instead of double-billing.
        if (overageCharge > 0) {
          await tx.payment.create({
            data: {
              reference: `SUB-OVER-${sub.id}-${periodNumber - 1}`,
              customerId: sub.customerId,
              type: "SUBSCRIPTION_CHARGE",
              method: "STRIPE",
              amount: overageCharge,
              gstAmount: gstFromInclusive(overageCharge),
              status: "PENDING",
              notes: `${sub.plan.name} — overage for period ending ${sub.currentPeriodEnd.toLocaleDateString("en-AU")} (${overageDays} day(s), ${overageKm} km over)`,
            },
          });
        }

        // Bill the NEW period's base fee.
        if (baseFee > 0) {
          await tx.payment.create({
            data: {
              reference: `SUB-${sub.id}-${periodNumber}`,
              customerId: sub.customerId,
              type: "SUBSCRIPTION_CHARGE",
              method: "STRIPE",
              amount: baseFee,
              gstAmount: gstFromInclusive(baseFee),
              status: "PENDING",
              notes: `${sub.plan.name} — period ${periodNumber} (${nextStart.toLocaleDateString("en-AU")} → ${nextEnd.toLocaleDateString("en-AU")})`,
            },
          });
        }

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
            `This will be charged to your card on file.`,
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
