/**
 * Pure helpers for reconciling the money history of committed vehicle swaps.
 *
 * Before the swap-money fix, `confirmSwap` never touched `booking.categoryId`
 * or the totals ledger: CHARGE deltas raised `balanceDue` but not
 * `totalAmount`/`gstAmount`, and REFUND deltas moved cash at Stripe without
 * decrementing `totalAmount`/`gstAmount`/`amountPaid`. These helpers let
 * `scripts/reconcile-swap-money.ts` reconstruct what a booking's ledger
 * SHOULD look like from its committed `BookingSwap` chain, and replay the
 * chain to spot swaps whose delta was quoted against the wrong (stale)
 * category. They are deliberately DB-free so the arithmetic is unit-testable.
 */
import { Prisma } from "@prisma/client";

import { aud, roundCents, sum } from "@/lib/money";

/** Appended to a SWAP-REF Payment's notes once the reconciliation script has
 *  retro-applied its ledger decrements. Same idempotency pattern as
 *  `scripts/reconcile-incident-charges.ts`. */
export const SWAP_REFUND_RECONCILED_MARKER = "[RECONCILED:swap-refund]";

export type SwapDirection = "NONE" | "CHARGE" | "REFUND";

export type SwapNetRow = {
  swapId: string;
  direction: SwapDirection;
  /** `BookingSwap.priceAdjustmentAmount` — always the absolute delta. */
  amount: Prisma.Decimal | number | string;
  /** `BookingSwap.priceAdjustmentGst` — always absolute. */
  gst: Prisma.Decimal | number | string;
  /** The linked settlement Payment row, when one exists. */
  payment: {
    reference: string;
    status: string;
    amount: Prisma.Decimal | number | string;
    notes: string | null;
  } | null;
};

export type UnappliedCashRefund = {
  swapId: string;
  reference: string;
  /** Cash that actually left via Stripe (the Payment amount, not the swap
   *  delta — post-fix the two can differ when part of the delta offset debt). */
  cash: Prisma.Decimal;
};

export type SwapNetReconstruction = {
  /** Effective CHARGE deltas — what the fixed code would have added to totals. */
  chargeTotal: Prisma.Decimal;
  chargeGst: Prisma.Decimal;
  /** Effective REFUND deltas — what the fixed code would have removed. */
  refundTotal: Prisma.Decimal;
  refundGst: Prisma.Decimal;
  /** Subset of the refund sums whose Payment already carries the
   *  reconciliation marker (retro-applied by a previous script run). */
  appliedRefundTotal: Prisma.Decimal;
  appliedRefundGst: Prisma.Decimal;
  /** SUCCEEDED SWAP-REF rows without the marker — their cash left via Stripe
   *  but `amountPaid` was never decremented. Candidates for the retro heal. */
  unappliedCashRefunds: UnappliedCashRefund[];
  /** Human-readable reasons the reconstruction is NOT provable (e.g. a
   *  PENDING cash refund). Non-empty ⇒ the caller must not auto-apply. */
  indeterminate: string[];
};

/**
 * Sum a committed swap chain into the totals movement the FIXED commit path
 * would have produced. Effectiveness rules mirror `confirmSwap`:
 *   - CHARGE increments totals at commit while the Payment is PENDING, so
 *     PENDING and SUCCEEDED charge rows count; anything else (FAILED,
 *     DISPUTED, refunded rollups, a missing row) is indeterminate.
 *   - REFUND with no Payment row is the pure balance write-down path — the
 *     totals decrement still applies.
 *   - A SUCCEEDED cash refund (SWAP-REF) counts, and additionally needs the
 *     retroactive `amountPaid` decrement unless already marker-stamped.
 *   - A FAILED cash refund left the ledger untouched by design — excluded.
 *   - A PENDING cash refund is indeterminate (cash may or may not have moved).
 *   - MANUAL_CREDIT (SWAP-CREDIT) rows write totals down at commit whether or
 *     not the credit is reconciled yet; FAILED credits are indeterminate.
 */
export function reconstructSwapNet(rows: SwapNetRow[]): SwapNetReconstruction {
  let chargeTotal = aud(0);
  let chargeGst = aud(0);
  let refundTotal = aud(0);
  let refundGst = aud(0);
  let appliedRefundTotal = aud(0);
  let appliedRefundGst = aud(0);
  const unappliedCashRefunds: UnappliedCashRefund[] = [];
  const indeterminate: string[] = [];

  for (const row of rows) {
    if (row.direction === "NONE") continue;
    const amount = aud(row.amount);
    const gst = aud(row.gst);

    if (row.direction === "CHARGE") {
      if (row.payment && ["PENDING", "SUCCEEDED"].includes(row.payment.status)) {
        chargeTotal = sum(chargeTotal, amount);
        chargeGst = sum(chargeGst, gst);
      } else {
        indeterminate.push(
          `swap ${row.swapId}: CHARGE payment ${row.payment ? `${row.payment.reference} is ${row.payment.status}` : "row missing"} — charge effectiveness unclear`,
        );
      }
      continue;
    }

    // direction === "REFUND"
    if (!row.payment) {
      // Pure balance write-down (fully offset against outstanding debt).
      refundTotal = sum(refundTotal, amount);
      refundGst = sum(refundGst, gst);
      continue;
    }
    const pay = row.payment;
    const isCashRefund = pay.reference.startsWith("SWAP-REF-");
    const isCredit = pay.reference.startsWith("SWAP-CREDIT-");
    if (isCashRefund && pay.status === "SUCCEEDED") {
      refundTotal = sum(refundTotal, amount);
      refundGst = sum(refundGst, gst);
      if (pay.notes?.includes(SWAP_REFUND_RECONCILED_MARKER)) {
        appliedRefundTotal = sum(appliedRefundTotal, amount);
        appliedRefundGst = sum(appliedRefundGst, gst);
      } else {
        unappliedCashRefunds.push({
          swapId: row.swapId,
          reference: pay.reference,
          cash: roundCents(pay.amount),
        });
      }
    } else if (isCashRefund && pay.status === "FAILED") {
      // Fixed code leaves the ledger untouched on a failed refund.
    } else if (isCashRefund) {
      indeterminate.push(
        `swap ${row.swapId}: cash refund ${pay.reference} is ${pay.status} — cannot prove whether cash moved`,
      );
    } else if (isCredit && ["PENDING", "SUCCEEDED"].includes(pay.status)) {
      refundTotal = sum(refundTotal, amount);
      refundGst = sum(refundGst, gst);
    } else {
      indeterminate.push(
        `swap ${row.swapId}: refund payment ${pay.reference} is ${pay.status} — refund effectiveness unclear`,
      );
    }
  }

  return {
    chargeTotal: roundCents(chargeTotal),
    chargeGst: roundCents(chargeGst),
    refundTotal: roundCents(refundTotal),
    refundGst: roundCents(refundGst),
    appliedRefundTotal: roundCents(appliedRefundTotal),
    appliedRefundGst: roundCents(appliedRefundGst),
    unappliedCashRefunds,
    indeterminate,
  };
}

export type SwapChainInput = {
  swapId: string;
  reason: string;
  direction: SwapDirection;
  /** Current category of the swap's outgoing vehicle. */
  outgoingCategoryId: string;
  /** Current category of the swap's incoming vehicle (null only on
   *  malformed/legacy rows). */
  incomingCategoryId: string | null;
};

export type SwapChainStep = SwapChainInput & {
  /** The category the booking ACTUALLY held entering this swap (previous
   *  swap's incoming category; chain starts at the first swap's outgoing). */
  correctOldCategoryId: string;
  /** What the pre-fix bug quoted against: `booking.categoryId`, which was
   *  never updated — i.e. the chain-start category, at every step. */
  staleOldCategoryId: string;
  /** True when the two differ — the recorded delta MAY have been quoted
   *  against the wrong category (double-charge / free-swap-back exposure).
   *  Only possible from the second swap onwards. */
  staleQuoteSuspect: boolean;
};

/**
 * Replay a booking's committed swaps in `swappedAt` order, tracking the
 * category actually held before each step versus the stale category the
 * pre-fix quote used. Callers overlay reason policy (fault/operational swaps
 * are zero-by-design and never mis-quoted in a money-bearing way).
 */
export function replaySwapChain(swaps: SwapChainInput[]): SwapChainStep[] {
  if (swaps.length === 0) return [];
  const staleOldCategoryId = swaps[0]!.outgoingCategoryId;
  let held = staleOldCategoryId;
  return swaps.map((swap) => {
    const correctOldCategoryId = held;
    held = swap.incomingCategoryId ?? held;
    return {
      ...swap,
      correctOldCategoryId,
      staleOldCategoryId,
      staleQuoteSuspect: correctOldCategoryId !== staleOldCategoryId,
    };
  });
}
