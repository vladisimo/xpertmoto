import type { Prisma, PrismaClient } from "@prisma/client";

import { logger } from "@/lib/logger";

import { tryIssueAdjustmentForBooking } from "./invoice-lifecycle";

/**
 * Single source of truth for the "charge a customer for an infringement"
 * side-effects:
 *
 *   1. Create a `Payment{ type: INFRINGEMENT_RECOVERY, status: PENDING }`.
 *   2. Increment `Booking.balanceDue` (when the infringement is linked
 *      to a booking) so the staff Payments console and the customer
 *      portal both reflect the outstanding amount.
 *   3. Best-effort issue an `AdjustmentNote` for tax/audit (mirrors the
 *      manual nominate-then-charge flow).
 *
 * Idempotent on `Payment.reference = INFR-${referenceNumber}` — calling
 * twice returns the existing payment without double-charging the
 * customer or double-counting balanceDue. This matters because the
 * helper is called both from interactive paths (manual charge) and from
 * the e-toll / Linkt sync workers, which may re-process the same row.
 *
 * The caller is responsible for setting `Infringement.status` to
 * `CUSTOMER_CHARGED` (or whatever transition is appropriate). The
 * helper deliberately does NOT touch the infringement row so it can be
 * called from contexts that already manage the row inside their own
 * transaction (e.g. the e-toll sync, which creates the Infringement and
 * the Payment in lock-step).
 */

type Numeric = string | number | { toNumber: () => number };

function toAud(v: Numeric | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return v.toNumber();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type InfringementChargeInput = {
  id: string;
  referenceNumber: string;
  type: string;
  issuer: string;
  amount: Numeric;
  adminFee: Numeric;
  bookingId: string | null;
  customerId: string | null;
};

export type InfringementChargeResult = {
  paymentId: string;
  alreadyExisted: boolean;
  amount: number;
};

/**
 * Create the Payment + balanceDue increment + AdjustmentNote for the
 * given infringement. Safe to call from any context (transaction or
 * not). The Payment + booking update run in a single inner transaction;
 * the AdjustmentNote is emitted after commit (best-effort, swallowed).
 *
 * Returns `alreadyExisted: true` when an `INFR-${referenceNumber}`
 * Payment was already on file — in that case nothing else is touched.
 */
export async function applyInfringementRecoveryCharge(args: {
  prisma: PrismaClient;
  infringement: InfringementChargeInput;
  performedById?: string | null;
  notes?: string;
}): Promise<InfringementChargeResult> {
  const { prisma, infringement: inf } = args;

  if (!inf.customerId) {
    throw new Error(
      `applyInfringementRecoveryCharge: infringement ${inf.id} has no customerId`,
    );
  }

  const issuerAmount = round2(toAud(inf.amount));
  const adminFee = round2(toAud(inf.adminFee));
  const total = round2(issuerAmount + adminFee);

  if (total <= 0) {
    throw new Error(
      `applyInfringementRecoveryCharge: infringement ${inf.id} has non-positive total (${total})`,
    );
  }

  const reference = `INFR-${inf.referenceNumber}`;

  const existing = await prisma.payment.findUnique({
    where: { reference },
    select: { id: true },
  });
  if (existing) {
    return { paymentId: existing.id, alreadyExisted: true, amount: total };
  }

  const defaultNotes =
    `Infringement ${inf.referenceNumber} (${inf.type}) — issuer A$${issuerAmount.toFixed(2)}` +
    (adminFee > 0 ? ` + admin fee A$${adminFee.toFixed(2)}` : "");

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        reference,
        bookingId: inf.bookingId,
        customerId: inf.customerId,
        type: "INFRINGEMENT_RECOVERY",
        method: "STRIPE",
        amount: total,
        status: "PENDING",
        notes: args.notes ?? defaultNotes,
        processedById: args.performedById ?? null,
      },
      select: { id: true },
    });
    if (inf.bookingId) {
      const booking = await tx.booking.findUnique({
        where: { id: inf.bookingId },
        select: { balanceDue: true },
      });
      if (booking) {
        await tx.booking.update({
          where: { id: inf.bookingId },
          data: { balanceDue: round2(toAud(booking.balanceDue) + total) },
        });
      }
    }
    return payment;
  });

  if (inf.bookingId) {
    try {
      await tryIssueAdjustmentForBooking({
        bookingId: inf.bookingId,
        type: "INCREASE",
        reason: "INFRINGEMENT",
        description: `Infringement recovery — ${inf.type} ${inf.referenceNumber}`,
        lineItems: [
          {
            description: `Issuer fine — ${inf.issuer} ${inf.referenceNumber}`,
            quantity: 1,
            unitPrice: issuerAmount,
            totalPrice: issuerAmount,
            gstIncluded: true,
          },
          ...(adminFee > 0
            ? [
                {
                  description: "Administration fee",
                  quantity: 1,
                  unitPrice: adminFee,
                  totalPrice: adminFee,
                  gstIncluded: true,
                },
              ]
            : []),
        ],
        paymentId: result.id,
        issuedById: args.performedById ?? null,
      });
    } catch (err) {
      logger.warn(
        { err, infringementId: inf.id, paymentId: result.id },
        "applyInfringementRecoveryCharge: AdjustmentNote issuance failed (non-blocking)",
      );
    }
  }

  return { paymentId: result.id, alreadyExisted: false, amount: total };
}

/**
 * Reverse-side of {@link applyInfringementRecoveryCharge}: when an
 * `INFRINGEMENT_RECOVERY` Payment is voided, the infringement should
 * step back to `NOMINATED` so it shows up correctly on the staff Tolls
 * tab and so re-charging is allowed. Caller is expected to have already
 * voided the Payment row.
 */
export async function revertInfringementOnVoid(
  prisma: PrismaClient | Prisma.TransactionClient,
  paymentReference: string,
): Promise<void> {
  if (!paymentReference.startsWith("INFR-")) return;
  const referenceNumber = paymentReference.slice("INFR-".length);
  const inf = await prisma.infringement.findUnique({
    where: { referenceNumber },
    select: { id: true, status: true, customerId: true, nominatedAt: true },
  });
  if (!inf) return;
  if (inf.status !== "CUSTOMER_CHARGED") return;
  await prisma.infringement.update({
    where: { id: inf.id },
    data: {
      status: inf.nominatedAt ? "NOMINATED" : "RECEIVED",
    },
  });
}

/**
 * Forward-side of capture: when an `INFRINGEMENT_RECOVERY` Payment is
 * captured (off-session by the cron, or interactively by staff), the
 * infringement should advance to `PAID` so dashboards stop showing it
 * as outstanding.
 */
export async function markInfringementPaidOnCapture(
  prisma: PrismaClient | Prisma.TransactionClient,
  paymentReference: string,
): Promise<void> {
  if (!paymentReference.startsWith("INFR-")) return;
  const referenceNumber = paymentReference.slice("INFR-".length);
  const inf = await prisma.infringement.findUnique({
    where: { referenceNumber },
    select: { id: true, status: true },
  });
  if (!inf) return;
  if (inf.status === "PAID") return;
  await prisma.infringement.update({
    where: { id: inf.id },
    data: { status: "PAID" },
  });
}
