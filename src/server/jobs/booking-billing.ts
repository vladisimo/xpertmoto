import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getQueue, registerWorker } from "./queue";

/**
 * Phase A2 — booking-billing
 *
 * Hourly sweep that finds `BookingBillingPlan` rows whose `nextChargeAt`
 * has passed and rolls them forward by one period. For each plan that
 * fires we:
 *   1. Create a Payment row of type SUBSCRIPTION_CHARGE, status PENDING,
 *      linked to the booking and customer. The `capture-pending-payments`
 *      job picks this up on its next tick and attempts an off-session
 *      charge against the customer's stored card.
 *   2. Advance the plan's `nextChargeAt` by one period length.
 *   3. Mark the plan COMPLETED once `periodsCompleted` reaches
 *      `periodsTotal` (i.e. every recurring period has been queued).
 *
 * This job *enqueues* charges; it never calls Stripe itself. All the
 * stored-card + 3DS handling lives in `capture-pending-payments`, so
 * retries + dunning are reused automatically.
 *
 * Idempotency: the plan's `periodsCompleted` counter plus the
 * `BOOKING-BILLING-<planId>-<periodNumber>` reference uniqueness ensure
 * that a duplicate run won't create a second Payment for the same period.
 */

const QUEUE = "booking-billing" as const;
const DEFAULT_BATCH = 200;

export type BookingBillingResult = {
  scanned: number;
  charged: number;
  completed: number;
  skipped: number;
};

function periodLengthMs(frequency: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY"): number {
  const days = frequency === "WEEKLY" ? 7 : frequency === "FORTNIGHTLY" ? 14 : 30;
  return days * 24 * 60 * 60 * 1000;
}

export async function runBookingBilling(
  opts: { now?: Date; batch?: number } = {},
): Promise<BookingBillingResult> {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? DEFAULT_BATCH;
  const result: BookingBillingResult = { scanned: 0, charged: 0, completed: 0, skipped: 0 };

  const due = await prisma.bookingBillingPlan.findMany({
    where: { status: "ACTIVE", nextChargeAt: { lte: now } },
    orderBy: { nextChargeAt: "asc" },
    take: batch,
    include: {
      booking: {
        select: {
          id: true,
          bookingReference: true,
          customerId: true,
          returnDateTime: true,
          status: true,
        },
      },
    },
  });

  for (const plan of due) {
    result.scanned += 1;

    // If the booking is already ended / cancelled / no-show, stop billing
    // — there's no reason to keep charging after the hire is closed.
    if (
      ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(plan.booking.status) ||
      plan.booking.returnDateTime.getTime() <= now.getTime()
    ) {
      await prisma.bookingBillingPlan.update({
        where: { id: plan.id },
        data: { status: "COMPLETED" },
      });
      result.completed += 1;
      continue;
    }

    // If we've already queued every recurring period, close the plan.
    if (plan.periodsCompleted >= plan.periodsTotal) {
      await prisma.bookingBillingPlan.update({
        where: { id: plan.id },
        data: { status: "COMPLETED" },
      });
      result.completed += 1;
      continue;
    }

    const periodNumber = plan.periodsCompleted + 1; // 1-indexed for human reference
    const reference = `BOOKING-BILLING-${plan.id}-${periodNumber}`;

    try {
      await prisma.$transaction(async (tx) => {
        // Create the Payment row — capture-pending-payments will charge
        // the stored card on its next tick.
        //
        // IMPORTANT: do NOT increment Booking.balanceDue here. Unlike every
        // other balance-affecting charge (manual charges, extensions, etc.
        // which add to balanceDue when raised), the full recurring balance
        // `recurringAmount × periodsTotal` was already pre-loaded into
        // balanceDue at confirmation time (booking.ts: `balanceDue =
        // totalAmount − payOnline`). It is removed period-by-period only when
        // each SUBSCRIPTION_CHARGE is captured, via applyCaptureToBalanceDue.
        // Adding an increment here would double-count the entire recurring
        // balance. See tests/unit/jobs/booking-billing.test.ts.
        await tx.payment.create({
          data: {
            reference,
            customerId: plan.booking.customerId,
            bookingId: plan.booking.id,
            type: "SUBSCRIPTION_CHARGE",
            method: "STRIPE",
            amount: plan.amountPerPeriod,
            gstAmount: plan.gstPerPeriod,
            status: "PENDING",
            notes: `Recurring charge #${periodNumber}/${plan.periodsTotal} (${plan.frequency.toLowerCase()})`,
          },
        });

        const nextAt = new Date(
          plan.nextChargeAt.getTime() + periodLengthMs(plan.frequency),
        );
        const newCompleted = plan.periodsCompleted + 1;
        const willFinish = newCompleted >= plan.periodsTotal;
        await tx.bookingBillingPlan.update({
          where: { id: plan.id },
          data: {
            periodsCompleted: newCompleted,
            chargesAttempted: { increment: 1 },
            lastChargedAt: now,
            nextChargeAt: willFinish
              ? plan.nextChargeAt // frozen when COMPLETED so downstream views don't re-fire
              : nextAt,
            status: willFinish ? "COMPLETED" : "ACTIVE",
          },
        });
      });
      result.charged += 1;
    } catch (err) {
      // Unique-key collision on `reference` means the same period was
      // already queued in a concurrent run — safe to skip.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        result.skipped += 1;
        continue;
      }
      logger.error(
        { err, planId: plan.id, bookingRef: plan.booking.bookingReference },
        "booking-billing: failed to enqueue recurring charge",
      );
      throw err;
    }
  }

  logger.info(result, "booking-billing tick complete");
  return result;
}

export function startBookingBillingScheduler() {
  registerWorker(QUEUE, async () => runBookingBilling());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Hourly sweep is plenty — charges are billed against a fixed
  // nextChargeAt so a slight delay is harmless. Using Brisbane tz to match
  // the rest of the scheduler fleet.
  q.add(
    "tick",
    {},
    { repeat: { pattern: "0 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-tick" },
  );
}
