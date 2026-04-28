import { Prisma, type AdjustmentReason, type PaymentType } from "@prisma/client";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { writePaymentAudit } from "@/server/services/audit-payment";
import {
  issueAdjustmentNote,
  issueInvoiceForBooking,
  issueReceiptForPayment,
} from "@/server/services/invoice-lifecycle";

import { getQueue, registerWorker } from "./queue";

/**
 * G17 — weekly retroactive sweep that backfills tax documents for
 * bookings the application code missed (network blip, render failure,
 * pre-migration row).
 *
 * Each pass does three independent jobs:
 *
 *   1. **Invoice backfill** — confirmed/active/completed bookings with
 *      no live Invoice get one issued via `issueInvoiceForBooking`.
 *      The booking carries the canonical pricing snapshot, so the
 *      generated invoice mirrors what the customer was originally
 *      quoted; line items reflect the snapshot, not any subsequent
 *      adjustments.
 *
 *   2. **Adjustment-note backfill** — every SUCCEEDED ancillary Payment
 *      (LATE_FEE / FUEL_CHARGE / DAMAGE_CHARGE / INFRINGEMENT_RECOVERY /
 *      EXTENSION / SWAP_ADJUSTMENT / REFUND / MANUAL_CHARGE /
 *      MANUAL_CREDIT / CLEANING_FEE / ZONE_SURCHARGE) that does NOT
 *      have an `AdjustmentNote.paymentId` link gets an adjustment note
 *      issued against its booking's invoice.
 *
 *   3. **Receipt backfill** — every SUCCEEDED Payment without a
 *      `receiptNumber` gets a branded receipt issued.
 *
 * The application code (booking.confirm, swap commit, check-in, admin
 * issueCreditNote, etc.) issues all three live. This sweep is a
 * safety net only — under steady-state operation it should generate
 * zero rows.
 */

const QUEUE = "invoice-generate" as const;
const LOOKBACK_DAYS = 180;

const ANCILLARY_TYPES: PaymentType[] = [
  "LATE_FEE",
  "FUEL_CHARGE",
  "DAMAGE_CHARGE",
  "INFRINGEMENT_RECOVERY",
  "EXTENSION",
  "SWAP_ADJUSTMENT",
  "REFUND",
  "MANUAL_CHARGE",
  "MANUAL_CREDIT",
  "CLEANING_FEE",
  "ZONE_SURCHARGE",
];

const REASON_BY_TYPE: Record<string, AdjustmentReason> = {
  LATE_FEE: "LATE_FEE",
  FUEL_CHARGE: "FUEL",
  DAMAGE_CHARGE: "DAMAGE",
  INFRINGEMENT_RECOVERY: "INFRINGEMENT",
  EXTENSION: "EXTENSION",
  SWAP_ADJUSTMENT: "SWAP",
  REFUND: "REFUND",
  MANUAL_CHARGE: "MANUAL",
  MANUAL_CREDIT: "MANUAL",
  CLEANING_FEE: "CLEANING",
  ZONE_SURCHARGE: "ZONE_SURCHARGE",
};

const DECREASE_TYPES = new Set(["REFUND", "MANUAL_CREDIT"]);

interface SweepResult {
  invoicesIssued: number;
  adjustmentsIssued: number;
  receiptsIssued: number;
}

export async function runInvoiceGenerate(): Promise<SweepResult> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const result: SweepResult = {
    invoicesIssued: 0,
    adjustmentsIssued: 0,
    receiptsIssued: 0,
  };

  // ── 1. Invoice backfill ──────────────────────────────────────────────────
  const bookingsMissingInvoice = await prisma.booking.findMany({
    where: {
      createdAt: { gte: since },
      status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "RETURNED", "COMPLETED"] },
      deletedAt: null,
      invoices: { none: { deletedAt: null, status: { not: "VOID" } } },
    },
    select: { id: true, bookingReference: true },
    take: 200, // pace the sweep — at 200 / week the backlog drains fast
  });

  for (const b of bookingsMissingInvoice) {
    try {
      const inv = await issueInvoiceForBooking({ bookingId: b.id });
      await writePaymentAudit(prisma, {
        action: "invoice.backfilled",
        entity: "Invoice",
        entityId: inv.id,
        userId: null,
        status: "SUCCESS",
        newData: { bookingReference: b.bookingReference, invoiceNumber: inv.invoiceNumber },
      });
      result.invoicesIssued += 1;
    } catch (err) {
      logger.warn({ err, bookingId: b.id }, "invoice-generate: invoice backfill failed");
    }
  }

  // ── 2. Adjustment-note backfill ──────────────────────────────────────────
  const orphanPayments = await prisma.payment.findMany({
    where: {
      status: "SUCCEEDED",
      type: { in: ANCILLARY_TYPES },
      processedAt: { gte: since },
      bookingId: { not: null },
      adjustmentNote: null,
    },
    select: {
      id: true,
      type: true,
      amount: true,
      gstAmount: true,
      reference: true,
      bookingId: true,
      notes: true,
      processedAt: true,
    },
    take: 500,
  });

  for (const p of orphanPayments) {
    if (!p.bookingId) continue;
    const invoice = await prisma.invoice.findFirst({
      where: { bookingId: p.bookingId, deletedAt: null, status: { not: "VOID" } },
      select: { id: true },
    });
    if (!invoice) continue; // Booking still has no invoice — skip; pass 1 will catch it next run.
    const reason = REASON_BY_TYPE[p.type] ?? "OTHER";
    const direction = DECREASE_TYPES.has(p.type) ? "DECREASE" : "INCREASE";

    try {
      await issueAdjustmentNote({
        invoiceId: invoice.id,
        type: direction,
        reason,
        description:
          p.notes?.trim() ??
          `${humanise(p.type)} (${p.reference})`,
        lineItems: [
          {
            description: humanise(p.type),
            detail: p.reference,
            quantity: 1,
            unitPrice: Math.abs(Number(p.amount)),
            totalPrice: Math.abs(Number(p.amount)),
            gstAmount: Math.abs(Number(p.gstAmount)),
            gstIncluded: true,
          },
        ],
        paymentId: p.id,
      });
      result.adjustmentsIssued += 1;
    } catch (err) {
      logger.warn(
        { err, paymentId: p.id, paymentType: p.type },
        "invoice-generate: adjustment-note backfill failed",
      );
    }
  }

  // ── 3. Receipt backfill ──────────────────────────────────────────────────
  const orphanReceipts = await prisma.payment.findMany({
    where: {
      status: "SUCCEEDED",
      receiptNumber: null,
      processedAt: { gte: since },
      deletedAt: null,
    },
    select: { id: true },
    take: 500,
  });

  for (const p of orphanReceipts) {
    try {
      await issueReceiptForPayment({ paymentId: p.id });
      result.receiptsIssued += 1;
    } catch (err) {
      logger.warn({ err, paymentId: p.id }, "invoice-generate: receipt backfill failed");
    }
  }

  logger.info(result, "invoice-generate sweep completed");
  return result;
}

function humanise(type: string): string {
  switch (type) {
    case "LATE_FEE":
      return "Late return fee";
    case "FUEL_CHARGE":
      return "Fuel shortfall";
    case "DAMAGE_CHARGE":
      return "Damage charge";
    case "INFRINGEMENT_RECOVERY":
      return "Infringement recovery";
    case "EXTENSION":
      return "Booking extension";
    case "SWAP_ADJUSTMENT":
      return "Vehicle swap adjustment";
    case "REFUND":
      return "Refund";
    case "MANUAL_CHARGE":
      return "Manual charge";
    case "MANUAL_CREDIT":
      return "Manual credit";
    case "CLEANING_FEE":
      return "Cleaning fee";
    case "ZONE_SURCHARGE":
      return "Zone surcharge";
    default:
      return type;
  }
}

// `Prisma` is imported above to keep the public type-import surface intact
// for any test that introspects this module's bindings; suppress the
// unused-binding lint without removing the import.
void Prisma;

export function startInvoiceGenerateScheduler() {
  registerWorker(QUEUE, async () => runInvoiceGenerate());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Weekly on Monday 09:00 Brisbane.
  q.add(
    "weekly",
    {},
    { repeat: { pattern: "0 9 * * 1", tz: "Australia/Brisbane" }, jobId: "repeat-invoice-gen" },
  );
}
