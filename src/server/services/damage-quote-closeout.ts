import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { gstFromInclusive } from "@/lib/money";
import { logger } from "@/lib/logger";
import { writePaymentAudit } from "./audit-payment";
import {
  recordAdditionalCharges,
  recordBookingCompletion,
} from "./revenue-aggregator";
import { sendNotification } from "./notification-sender";
import {
  applyExcessCap,
  getBookingExcess,
  getDamageLiabilityUsed,
} from "./excess";

type PrismaLike = PrismaClient | typeof defaultPrisma;

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Close out QUOTE_PENDING damage charges when their repair work order
 * completes. The customer signed a liability cap at return
 * (`quoteCapAmount`); the billable amount is min(actual repair cost, cap),
 * raised as a PENDING DAMAGE_CHARGE Payment (+ balanceDue increment) that
 * capture-pending-payments collects off-session — the same pipeline as every
 * other ancillary charge.
 *
 * When the booking was parked RETURNED awaiting this quote and no other
 * unresolved quotes remain, the booking flips to COMPLETED via
 * recordBookingCompletion (the loyalty/spend-counter invariant — a plain
 * status update would drift the rewards ledger).
 *
 * Idempotent: the `DMG-<chargeId>` unique reference and the
 * capturedPaymentId-null filter make a re-completed work order a no-op.
 */
export async function closeOutQuotePendingCharges(
  prisma: PrismaLike,
  args: {
    workOrderId: string;
    actualCost: number | null;
    staffUserId: string;
  },
): Promise<{ billed: number; bookingCompleted: boolean }> {
  const charges = await prisma.damageCharge.findMany({
    where: {
      workOrderId: args.workOrderId,
      resolution: "QUOTE_PENDING",
      status: { in: ["PROVISIONAL", "CONFIRMED"] },
      capturedPaymentId: null,
    },
    include: {
      returnAssessment: {
        select: {
          bookingId: true,
          booking: {
            select: {
              id: true,
              bookingReference: true,
              customerId: true,
              depotId: true,
              status: true,
              actualReturnDateTime: true,
              subtotal: true,
              addonTotal: true,
              gstAmount: true,
              totalAmount: true,
            },
          },
        },
      },
    },
  });
  if (charges.length === 0) return { billed: 0, bookingCompleted: false };

  let billed = 0;
  let bookingCompleted = false;
  for (const charge of charges) {
    const booking = charge.returnAssessment.booking;
    const cap = Number(charge.quoteCapAmount ?? 0);
    const ackCapped = r2(
      Math.min(args.actualCost ?? cap, cap > 0 ? cap : args.actualCost ?? 0),
    );
    // Excess cap (per-hire aggregate): the acknowledged quote cap is one
    // ceiling, the hire's remaining excess headroom is the other. Recomputed
    // per charge — each billed line lands as a CONFIRMED DamageCharge, so
    // the next iteration's `used` figure already includes it.
    const bookingExcess = await getBookingExcess(prisma, booking.id);
    const liabilityUsed = await getDamageLiabilityUsed(prisma, booking.id);
    const { chargeable: billAmount, cappedBy: excessCappedBy } = applyExcessCap({
      proposed: ackCapped,
      used: liabilityUsed,
      excess: bookingExcess.excess,
    });

    try {
      await prisma.$transaction(async (tx) => {
        if (billAmount > 0) {
          const payment = await tx.payment.create({
            data: {
              reference: `DMG-${charge.id}`,
              customerId: booking.customerId,
              bookingId: booking.id,
              type: "DAMAGE_CHARGE",
              method: "STRIPE",
              amount: billAmount,
              gstAmount: gstFromInclusive(billAmount),
              status: "PENDING",
              notes: `Repair quote finalised (cap A$${cap.toFixed(2)}) — ${charge.description.slice(0, 120)}`,
              processedById: args.staffUserId,
            },
          });
          await tx.damageCharge.update({
            where: { id: charge.id },
            data: {
              status: "CONFIRMED",
              amount: billAmount,
              capturedPaymentId: payment.id,
              resolvedAt: new Date(),
              resolvedById: args.staffUserId,
            },
          });
          // Raise → add half of the balanceDue contract; the sweep's capture
          // nets it back out.
          await tx.booking.update({
            where: { id: booking.id },
            data: { balanceDue: { increment: billAmount } },
          });
          await recordAdditionalCharges(tx, {
            depotId: booking.depotId,
            at: new Date(),
            damageAmount: billAmount,
            lateFeeAmount: 0,
            fuelChargeAmount: 0,
          });
        } else {
          // Repair cost came back zero (warranty / goodwill) — resolve the
          // charge without billing.
          await tx.damageCharge.update({
            where: { id: charge.id },
            data: {
              status: "CONFIRMED",
              amount: 0,
              resolvedAt: new Date(),
              resolvedById: args.staffUserId,
            },
          });
        }
      });
      billed += billAmount > 0 ? 1 : 0;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), damageChargeId: charge.id },
        "damage-quote-closeout: failed to bill charge",
      );
      continue;
    }

    await writePaymentAudit(prisma, {
      action: "damage_quote.closed_out",
      entity: "DamageCharge",
      entityId: charge.id,
      userId: args.staffUserId,
      status: "SUCCESS",
      newData: {
        bookingId: booking.id,
        workOrderId: args.workOrderId,
        capAud: cap,
        actualCostAud: args.actualCost,
        billedAud: billAmount,
        excessAud: bookingExcess.excess,
        excessUsedBeforeAud: liabilityUsed,
        excessCappedByAud: excessCappedBy,
      },
    });

    if (billAmount > 0) {
      await sendNotification({
        userId: booking.customerId,
        type: "PAYMENT_RECEIVED",
        channels: ["EMAIL"],
        subject: `Repair cost finalised — ${booking.bookingReference}`,
        title: "Repair cost finalised",
        body:
          `The repair quote for damage on booking ${booking.bookingReference} has been finalised at ` +
          `A$${billAmount.toFixed(2)} (your acknowledged cap was A$${cap.toFixed(2)}). ` +
          `This will be charged to your card on file.`,
        bookingId: booking.id,
        data: { damageChargeId: charge.id, amountAud: billAmount },
      }).catch(() => {
        // Notification is best-effort; the charge itself is already raised.
      });
    }

    // Flip a quote-parked booking to COMPLETED once its last quote resolves.
    if (booking.status === "RETURNED") {
      const remaining = await prisma.damageCharge.count({
        where: {
          returnAssessment: { bookingId: booking.id },
          resolution: "QUOTE_PENDING",
          status: { in: ["PROVISIONAL", "CONFIRMED"] },
          capturedPaymentId: null,
        },
      });
      if (remaining === 0) {
        await prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: "COMPLETED",
              statusLog: {
                create: {
                  previousStatus: "RETURNED",
                  newStatus: "COMPLETED",
                  changedById: args.staffUserId,
                  reason: "All repair quotes resolved",
                },
              },
            },
          });
          // Booking-completion invariant: counters/loyalty derive from this
          // call — never flip to COMPLETED without it.
          await recordBookingCompletion(tx, {
            id: booking.id,
            customerId: booking.customerId,
            depotId: booking.depotId,
            actualReturnDateTime: booking.actualReturnDateTime ?? new Date(),
            subtotal: booking.subtotal,
            addonTotal: booking.addonTotal,
            gstAmount: booking.gstAmount,
            totalAmount: booking.totalAmount,
          });
        });
        bookingCompleted = true;
      }
    }
  }

  return { billed, bookingCompleted };
}
