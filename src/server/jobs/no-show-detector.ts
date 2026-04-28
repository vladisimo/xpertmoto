import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { writePaymentAudit } from "@/server/services/audit-payment";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

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
      bondLedger: {
        select: {
          id: true,
          status: true,
          heldAmount: true,
          capturedAmount: true,
          releasedAmount: true,
          deductions: true,
        },
      },
    },
  });

  let marked = 0;
  for (const b of candidates) {
    const ledger = b.bondLedger;
    const canForfeitBond = !!ledger && ledger.status === "HELD";
    const forfeitedAmount = canForfeitBond ? Number(ledger.heldAmount) : 0;

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

        if (canForfeitBond && ledger) {
          const existingDeductions = Array.isArray(ledger.deductions)
            ? [...(ledger.deductions as Array<{ reason: string; amount: number }>)]
            : [];
          existingDeductions.push({ reason: "No-show forfeiture", amount: forfeitedAmount });
          await tx.bondLedger.update({
            where: { id: ledger.id },
            data: {
              status: "FULLY_CAPTURED",
              capturedAmount: forfeitedAmount,
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
      }
      marked += 1;
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
  const q = getQueue(QUEUE);
  if (!q) return;
  // Every hour. Cheap scan, low-cardinality candidates.
  q.add("hourly", {}, { repeat: { pattern: "0 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-hourly" });
}
