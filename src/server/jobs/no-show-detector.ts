import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { capturePaymentIntent } from "@/lib/stripe";
import { getSettings } from "@/lib/settings";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { sendNotification } from "@/server/services/notification-sender";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";
import { recomputeCustomerRewards } from "@/server/services/customer-rewards";
import { getQueue, monitorCron, registerWorker } from "./queue";

/**
 * G22 — no-show detector.
 *
 * Scans CONFIRMED bookings whose `pickupDateTime` is more than N hours in
 * the past and whose `actualPickupDateTime` is still null. Transitions
 * them to NO_SHOW, forfeits the bond hold (full capture), records a
 * BookingStatusLog row, frees the assigned vehicle, and emails the
 * customer.
 *
 * Grace window and no-show fee are configurable via SystemSetting:
 *   - `booking.noShowGraceHours`        (default 2)
 *   - `cancellation.noShowFee`          (default 50; only used as a
 *                                        fallback when no bond was held)
 *
 * Bond handling:
 *   - HELD bond → fully captured as `No-show forfeiture`. Mirrors the
 *     captureBond pattern in booking-settlement.ts (ledger update +
 *     BOND_CAPTURE Payment row).
 *   - No bond ledger (cash / walk-in) → MANUAL_CHARGE Payment row for
 *     the configured no-show fee, since there's no existing auth to
 *     capture from.
 *
 * Idempotent: the `status = CONFIRMED` filter plus the status update in
 * the same $transaction prevents double-processing. Re-running after a
 * successful transition is a no-op.
 */

const QUEUE = "no-show-detector" as const;

export async function runNoShowDetector(opts: { graceHours?: number; feeAud?: number } = {}): Promise<{
  scanned: number;
  markedNoShow: number;
}> {
  const cfg = await getSettings([
    "booking.noShowGraceHours",
    "cancellation.noShowFee",
  ] as const);
  const graceHours = opts.graceHours ?? cfg["booking.noShowGraceHours"];
  const feeAud = opts.feeAud ?? cfg["cancellation.noShowFee"];
  const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);

  const candidates = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      pickupDateTime: { lt: cutoff },
      actualPickupDateTime: null,
    },
    select: {
      id: true,
      bookingReference: true,
      customerId: true,
      vehicleId: true,
      pickupDateTime: true,
      bondAmount: true,
      pickupDepot: { select: { slug: true } },
      bondLedger: {
        select: {
          id: true,
          status: true,
          heldAmount: true,
          capturedAmount: true,
          releasedAmount: true,
          deductions: true,
          stripePaymentIntentId: true,
        },
      },
    },
  });

  let marked = 0;
  for (const b of candidates) {
    const ledger = b.bondLedger;
    const canForfeitBond = !!ledger && ledger.status === "HELD";
    // Forfeit only the still-capturable remainder so a bond that was already
    // part-released can't push captured+released over heldAmount (DB CHECK).
    const forfeitedAmount =
      canForfeitBond && ledger
        ? Math.max(
            0,
            Number(ledger.heldAmount) -
              Number(ledger.capturedAmount) -
              Number(ledger.releasedAmount),
          )
        : 0;

    // Capture the bond hold at Stripe BEFORE the DB transaction. On a Stripe
    // failure, skip this booking entirely — the CONFIRMED filter makes the
    // next run retry rather than leaving a phantom forfeiture on the books.
    let bondChargeId: string | null = null;
    if (canForfeitBond && forfeitedAmount > 0 && ledger) {
      try {
        const capture = await capturePaymentIntent(ledger.stripePaymentIntentId, {
          amountToCaptureCents: Math.round(forfeitedAmount * 100),
          idempotencyKey: `bond-capture-noshow-${b.id}`,
        });
        bondChargeId = capture.latestChargeId;
      } catch (err) {
        logger.warn(
          { err, bookingId: b.id, bookingReference: b.bookingReference },
          "no-show-detector: bond capture failed at Stripe; skipping this booking (will retry next run)",
        );
        continue;
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: b.id },
          data: {
            status: "NO_SHOW",
            cancellationReason: `Auto-marked NO_SHOW — customer did not arrive within ${graceHours}h of pickup`,
            statusLog: {
              create: {
                previousStatus: "CONFIRMED",
                newStatus: "NO_SHOW",
                reason: `no-show-detector: grace ${graceHours}h expired`,
              },
            },
          },
        });

        // Cancel any long-term recurring billing plan in the same transaction,
        // mirroring booking-cancellation.ts — don't rely on the hourly
        // booking-billing tick to notice the NO_SHOW status, which would leave
        // an ACTIVE plan able to queue a charge against a no-show in between.
        await tx.bookingBillingPlan.updateMany({
          where: { bookingId: b.id, status: { notIn: ["CANCELLED", "COMPLETED"] } },
          data: { status: "CANCELLED", cancelReason: "Booking marked as no-show" },
        });

        if (canForfeitBond && forfeitedAmount > 0 && ledger) {
          const existingDeductions = Array.isArray(ledger.deductions)
            ? [...(ledger.deductions as Array<{ reason: string; amount: number }>)]
            : [];
          existingDeductions.push({ reason: "No-show forfeiture", amount: forfeitedAmount });
          // A single capture finalises the hold — land terminal so the DB
          // CHECK (captured + released == held) holds.
          const newCaptured = Number(ledger.capturedAmount) + forfeitedAmount;
          const newReleased = Number(ledger.heldAmount) - newCaptured;
          await tx.bondLedger.update({
            where: { id: ledger.id },
            data: {
              status: "FULLY_CAPTURED",
              capturedAmount: newCaptured,
              releasedAmount: newReleased,
              deductions: existingDeductions as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.payment.create({
            data: {
              reference: `BOND-CAP-NOSHOW-${b.id}`,
              customerId: b.customerId,
              bookingId: b.id,
              type: "BOND_CAPTURE",
              method: "STRIPE",
              amount: forfeitedAmount,
              gstAmount: 0,
              status: "SUCCEEDED",
              // Link the Stripe ids so reconcile matches this to the charge.
              stripePaymentIntentId: ledger.stripePaymentIntentId,
              stripeChargeId: bondChargeId,
              processedAt: new Date(),
              notes: "Bond capture: no-show forfeiture",
            },
          });
        } else if (feeAud > 0 && b.customerId) {
          // No bond auth to capture against — fall back to a manual
          // charge for the configured no-show fee.
          await tx.payment.create({
            data: {
              reference: `NOSHOW-${b.id}`,
              customerId: b.customerId,
              bookingId: b.id,
              type: "MANUAL_CHARGE",
              method: "STRIPE",
              amount: feeAud,
              status: "PENDING",
              notes: `No-show fee (pickup ${b.pickupDateTime.toISOString()})`,
            },
          });
          // Owed until the capture-pending job collects it. Add to balanceDue
          // so applyCaptureToBalanceDue nets it out on capture, keeping the
          // raise→add / collect→remove invariant (see balance-due.ts).
          await tx.booking.update({
            where: { id: b.id },
            data: { balanceDue: { increment: feeAud } },
          });
        }

        if (b.vehicleId) {
          await tx.vehicle.update({
            where: { id: b.vehicleId },
            data: { status: "AVAILABLE" },
          });
        }
      });

      await writePaymentAudit(prisma, {
        action: "booking.no_show",
        entity: "Payment",
        entityId: b.id,
        userId: b.customerId ?? undefined,
        status: "SUCCESS",
        newData: {
          bookingReference: b.bookingReference,
          pickupDateTime: b.pickupDateTime.toISOString(),
          graceHours,
          bondForfeitedAud: canForfeitBond ? forfeitedAmount : 0,
          fallbackFeeAud: canForfeitBond ? 0 : feeAud,
          vehicleReleased: !!b.vehicleId,
        },
      });

      if (b.customerId) {
        const body = canForfeitBond
          ? `We're sorry we missed you. Booking ${b.bookingReference} was scheduled to start at ${b.pickupDateTime.toISOString()}; we waited ${graceHours} hours before marking it as a no-show. Your A$${forfeitedAmount.toFixed(2)} bond has been forfeited per our cancellation policy.\n\nIf this is a mistake or you'd like to rebook, please contact us.`
          : `We're sorry we missed you. Booking ${b.bookingReference} was scheduled to start at ${b.pickupDateTime.toISOString()}; we waited ${graceHours} hours before marking it as a no-show. A no-show fee of A$${feeAud.toFixed(2)} has been applied.\n\nIf this is a mistake or you'd like to rebook, please contact us.`;
        await sendNotification({
          userId: b.customerId,
          type: "BOOKING_CANCELLED",
          channels: ["EMAIL"],
          subject: `Booking ${b.bookingReference} — marked as no-show`,
          title: "Booking marked as no-show",
          body,
          bookingId: b.id,
          data: {
            bookingReference: b.bookingReference,
            bondForfeitedAud: canForfeitBond ? forfeitedAmount : 0,
            fallbackFeeAud: canForfeitBond ? 0 : feeAud,
          },
        });
        await trackServer({
          event: SERVER_EVENTS.bookingNoShowDetected,
          distinctId: b.customerId,
          properties: {
            bookingId: b.id,
            reference: b.bookingReference,
            graceHours,
            bondForfeitedAud: canForfeitBond ? forfeitedAmount : 0,
            noShowFeeAud: canForfeitBond ? 0 : feeAud,
          },
          groups: { depot: b.pickupDepot.slug },
        });
      }
      marked += 1;

      // Credit the rental invoice down to $0 — the supply was never
      // provided. The no-show fee / bond forfeiture is a separate punitive
      // charge with its own document, NOT retained rental consideration, so
      // `retained: 0`. Best-effort + idempotent (one CANCELLATION credit per
      // invoice); the weekly sweep is the backstop.
      try {
        const { tryIssueCancellationAdjustment } = await import(
          "@/server/services/invoice-lifecycle"
        );
        await tryIssueCancellationAdjustment({
          bookingId: b.id,
          retained: 0,
          refundAmount: 0,
          detail: `No-show — pickup ${b.pickupDateTime.toISOString()}`,
          description: "Cancellation credit — booking marked as no-show (rental not provided)",
        });
      } catch {
        // tryIssueCancellationAdjustment already swallows + logs.
      }

      // Reflect any forfeited/retained money in the rewards counters
      // promptly. Best-effort — the nightly recompute is the backstop.
      if (b.customerId) {
        try {
          await recomputeCustomerRewards(prisma, b.customerId);
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err), bookingId: b.id },
            "no-show-detector: rewards recompute failed",
          );
        }
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: b.id },
        "no-show-detector: failed to mark booking",
      );
    }
  }

  logger.info({ scanned: candidates.length, marked }, "no-show-detector completed");
  return { scanned: candidates.length, markedNoShow: marked };
}

export function startNoShowDetectorScheduler() {
  registerWorker(QUEUE, async () => runNoShowDetector());
  monitorCron(QUEUE, "0 * * * *");
  const q = getQueue(QUEUE);
  if (!q) return;
  // Every hour. Cheap scan, low-cardinality candidates.
  q.add("hourly", {}, { repeat: { pattern: "0 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-hourly" });
}
