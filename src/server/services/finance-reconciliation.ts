import type { PaymentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roundCents } from "@/lib/money";
import {
  isNonCashPayment,
  paymentNetWeight,
  signedPaymentAmount,
} from "@/lib/payment-labels";
import { runStripeReconcile } from "@/server/jobs/stripe-reconcile";

/**
 * Transaction-level reconciliation between the system's Payment ledger (the
 * "book side") and Stripe's settled balance transactions (the "Stripe side",
 * mirrored into StripeFeeLedger by the nightly `stripe-reconcile` job).
 *
 * Replaces the old amount-only aggregation that (a) counted non-cash bond
 * holds/releases as book revenue, (b) never netted refunds, and (c) compared
 * Payment rows to Payment rows rather than to Stripe. Here every cash-settling
 * Payment is matched to its Stripe charge by `stripeChargeId`, so a discrepancy
 * points at a specific transaction.
 *
 * Known limitation: StripeFeeLedger keeps one fee row per charge id (a refund
 * on an already-present charge updates that row's net rather than adding its
 * own row), so a *settled* refund's Stripe-side netting is best-effort until a
 * dedicated balance-transaction store exists. Refunds are always netted exactly
 * on the book side. The common pending-refund case reconciles precisely.
 */

export type ReconStatus =
  | "MATCHED"
  | "AMOUNT_MISMATCH"
  | "MISSING_IN_STRIPE"
  | "MISSING_IN_BOOK"
  | "NON_CASH"
  | "UNLINKED";

export interface ReconRow {
  /** Stable row key: the payment id, or `stripe:<chargeId>` for book-less charges. */
  key: string;
  paymentId: string | null;
  reference: string | null;
  bookingId: string | null;
  bookingReference: string | null;
  customer: string | null;
  type: PaymentType | null;
  status: ReconStatus;
  stripeChargeId: string | null;
  /** Signed book amount (negative for refunds/credits); null for Stripe-only rows. */
  bookAmount: number | null;
  /** Stripe gross for the charge; null for book-only / unlinked rows. */
  stripeAmount: number | null;
}

export interface ReconciliationSummary {
  stripeNet: number;
  bookNet: number;
  variance: number;
  matchedCount: number;
  unmatchedCount: number;
}

export interface ReconUnmatched {
  id: string;
  source: string;
  externalId: string;
  amount: number;
  occurredAt: Date;
  reason: string;
}

export interface ReconciliationReport {
  summary: ReconciliationSummary;
  rows: ReconRow[];
  unmatched: ReconUnmatched[];
}

export interface ReconcileInput {
  from: Date;
  to: Date;
  depotId?: string;
  /** Refresh the Stripe mirror for this window before reading (dev). */
  live?: boolean;
}

/** Half-cent tolerance for amount matching. */
const MATCH_TOLERANCE = 0.005;

/** A Stripe charge/refund in the window with no matching Payment row. */
function missingInBook(stripeId: string, stripeAmount: number): ReconRow {
  return {
    key: `stripe:${stripeId}`,
    paymentId: null,
    reference: null,
    bookingId: null,
    bookingReference: null,
    customer: null,
    type: null,
    status: "MISSING_IN_BOOK",
    stripeChargeId: stripeId,
    bookAmount: null,
    stripeAmount,
  };
}

export async function reconcilePayments(input: ReconcileInput): Promise<ReconciliationReport> {
  if (input.live) {
    // Refresh the Stripe mirror for exactly this window without advancing the
    // nightly checkpoint, so freshly-created test data shows immediately.
    await runStripeReconcile({
      windowStart: input.from,
      windowEnd: input.to,
      advanceCheckpoint: false,
    });
  }

  const [payments, ledger, unmatchedRows] = await Promise.all([
    prisma.payment.findMany({
      where: {
        createdAt: { gte: input.from, lte: input.to },
        deletedAt: null,
        // Settled-cash statuses: a PARTIALLY_REFUNDED / REFUNDED original still
        // represents a charge that settled on Stripe (the refund is its own
        // REFUND row, weighted -1). PENDING / FAILED never moved money. Same
        // basis as the Invoices reconciliation in admin.financeInvoices.
        status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
        ...(input.depotId ? { booking: { depotId: input.depotId } } : {}),
      },
      select: {
        id: true,
        reference: true,
        type: true,
        amount: true,
        stripeChargeId: true,
        stripePaymentIntentId: true,
        bookingId: true,
        booking: { select: { bookingReference: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.stripeFeeLedger.findMany({
      where: { balanceTxnCreatedAt: { gte: input.from, lte: input.to } },
      select: {
        stripeChargeId: true,
        stripePaymentIntentId: true,
        feeType: true,
        netAmountCents: true,
        feeAmountCents: true,
      },
    }),
    prisma.unmatchedTransaction.findMany({
      where: { occurredAt: { gte: input.from, lte: input.to }, resolvedAt: null },
      orderBy: { occurredAt: "desc" },
    }),
  ]);

  // Bond holds/releases never settle as cash (no balance transaction), so they
  // can't be amount-matched — but the held authorisation is a real Stripe
  // PaymentIntent on the BondLedger. Surface it as a reference so the bond row
  // links to Stripe instead of reading as orphaned.
  const bondBookingIds = [
    ...new Set(
      payments
        .filter((p) => isNonCashPayment(p.type) && p.bookingId)
        .map((p) => p.bookingId as string),
    ),
  ];
  const bondPiByBooking = new Map<string, string>();
  if (bondBookingIds.length) {
    const bondLedgers = await prisma.bondLedger.findMany({
      where: { bookingId: { in: bondBookingIds }, stripePaymentIntentId: { not: null } },
      select: { bookingId: true, stripePaymentIntentId: true },
    });
    for (const b of bondLedgers) {
      if (b.stripePaymentIntentId) bondPiByBooking.set(b.bookingId, b.stripePaymentIntentId);
    }
  }

  // --- Stripe side: indexed three ways + signed net total. Charges
  // (stripe_fee) match an inflow Payment by charge id or payment intent;
  // refunds (refund_fee) match an outflow Payment by the refund id Stripe
  // returns (stored in the refund Payment's stripeChargeId). ---
  type LedgerEntry = { id: string; gross: number };
  const chargeById = new Map<string, LedgerEntry>();
  const chargeByPi = new Map<string, LedgerEntry>();
  const refundById = new Map<string, LedgerEntry>();
  let stripeNet = 0;
  for (const l of ledger) {
    const gross = (l.netAmountCents + l.feeAmountCents) / 100;
    if (l.feeType === "refund_fee") {
      const mag = Math.abs(gross);
      refundById.set(l.stripeChargeId, { id: l.stripeChargeId, gross: mag });
      stripeNet -= mag;
      continue;
    }
    const lc: LedgerEntry = { id: l.stripeChargeId, gross };
    chargeById.set(l.stripeChargeId, lc);
    if (l.stripePaymentIntentId) chargeByPi.set(l.stripePaymentIntentId, lc);
    stripeNet += gross;
  }

  // --- Book side + per-transaction matching. ---
  const rows: ReconRow[] = [];
  const seenCharges = new Set<string>();
  const seenRefunds = new Set<string>();
  let bookNet = 0;
  let matchedCount = 0;

  for (const p of payments) {
    const amount = Number(p.amount);
    const weight = paymentNetWeight(p.type);
    bookNet += weight * amount;

    const base = {
      key: p.id,
      paymentId: p.id,
      reference: p.reference,
      bookingId: p.bookingId,
      bookingReference: p.booking?.bookingReference ?? null,
      customer: p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : null,
      type: p.type,
      stripeChargeId: p.stripeChargeId,
      bookAmount: signedPaymentAmount(p.type, amount),
    };

    // Bond holds/releases are authorisations, not cash — shown but never
    // matched. Surface the held PaymentIntent (from the Payment or its
    // BondLedger) so the row links to Stripe.
    if (isNonCashPayment(p.type)) {
      const bondPi =
        p.stripePaymentIntentId ?? (p.bookingId ? bondPiByBooking.get(p.bookingId) : undefined) ?? null;
      rows.push({ ...base, stripeChargeId: bondPi, status: "NON_CASH", stripeAmount: null });
      continue;
    }

    // Outflows (refunds / credits): match the Stripe refund by its id. A
    // credit/payout with no Stripe refund id (manual credit, partner payout)
    // has nothing to match against.
    if (weight === -1) {
      if (!p.stripeChargeId) {
        rows.push({ ...base, status: "UNLINKED", stripeAmount: null });
        continue;
      }
      const rl = refundById.get(p.stripeChargeId);
      if (!rl) {
        rows.push({ ...base, status: "MISSING_IN_STRIPE", stripeAmount: null });
        continue;
      }
      seenRefunds.add(rl.id);
      if (Math.abs(rl.gross - amount) > MATCH_TOLERANCE) {
        rows.push({ ...base, status: "AMOUNT_MISMATCH", stripeAmount: -rl.gross });
      } else {
        rows.push({ ...base, status: "MATCHED", stripeAmount: -rl.gross });
        matchedCount += 1;
      }
      continue;
    }

    // Inflows (charges): a charge with neither a charge id nor a PI (cash, bank
    // transfer) has nothing to match against.
    if (!p.stripeChargeId && !p.stripePaymentIntentId) {
      rows.push({ ...base, status: "UNLINKED", stripeAmount: null });
      continue;
    }
    // Join on charge id first, then fall back to payment intent.
    const lc =
      (p.stripeChargeId ? chargeById.get(p.stripeChargeId) : undefined) ??
      (p.stripePaymentIntentId ? chargeByPi.get(p.stripePaymentIntentId) : undefined);
    if (!lc) {
      rows.push({ ...base, status: "MISSING_IN_STRIPE", stripeAmount: null });
      continue;
    }
    seenCharges.add(lc.id);
    // Surface the resolved Stripe charge id even when the Payment row lacked it.
    const matchedBase = { ...base, stripeChargeId: lc.id };
    if (Math.abs(lc.gross - amount) > MATCH_TOLERANCE) {
      rows.push({ ...matchedBase, status: "AMOUNT_MISMATCH", stripeAmount: lc.gross });
    } else {
      rows.push({ ...matchedBase, status: "MATCHED", stripeAmount: lc.gross });
      matchedCount += 1;
    }
  }

  // Stripe charges / refunds in the window with no matching Payment.
  for (const { id, gross } of chargeById.values()) {
    if (seenCharges.has(id)) continue;
    rows.push(missingInBook(id, gross));
  }
  for (const { id, gross } of refundById.values()) {
    if (seenRefunds.has(id)) continue;
    rows.push(missingInBook(id, -gross));
  }

  const unmatchedCount = rows.filter(
    (r) =>
      r.status === "MISSING_IN_STRIPE" ||
      r.status === "MISSING_IN_BOOK" ||
      r.status === "AMOUNT_MISMATCH",
  ).length;

  return {
    summary: {
      stripeNet: roundCents(stripeNet).toNumber(),
      bookNet: roundCents(bookNet).toNumber(),
      variance: roundCents(bookNet - stripeNet).toNumber(),
      matchedCount,
      unmatchedCount,
    },
    rows,
    unmatched: unmatchedRows.map((u) => ({
      id: u.id,
      source: u.source,
      externalId: u.externalId,
      amount: u.amountCents / 100,
      occurredAt: u.occurredAt,
      reason: u.reason,
    })),
  };
}
