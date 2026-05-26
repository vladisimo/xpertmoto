import type { PaymentType } from "@prisma/client";
import { paymentNetWeight } from "@/lib/payment-labels";
import { roundCents } from "@/lib/money";

/**
 * Invoice reconciliation — joins the immutable invoice document to the two
 * authoritative ledgers that actually move with the booking:
 *
 * - **AdjustmentNote** rows (ATO §29-75 consideration changes) supply the
 *   signed delta against the issued total. The schema invariant is
 *   `financial position = invoice.totalAmount + Σ adjustmentNotes.totalAmount`.
 * - **Payment** rows supply net cash, weighted by {@link paymentNetWeight} so
 *   refunds subtract and bond authorisations (hold/release) count as zero —
 *   exactly how the Finance → Transactions tab computes its NET.
 *
 * Pure and DB-agnostic: callers coerce Prisma `Decimal`s to `number` first.
 */

/**
 * Closed-out booking states. Once a booking reaches one of these, the rental
 * is settled and nothing further is collectible against it — so its invoice's
 * outstanding is driven by the maintained `Booking.balanceDue` counter (the
 * same AR figure the Finance → Overview tab reports), not by the document-level
 * `net − collected`, which over-reports for deposit-based or cancelled bookings.
 */
export const TERMINAL_BOOKING_STATUSES: ReadonlySet<string> = new Set([
  "RETURNED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "DISPUTED",
]);

/** A single invoice's immutable total plus its non-void adjustment notes. */
export interface ReconcileInvoiceInput {
  bookingId: string | null;
  /** Booking lifecycle state, or null for a standalone invoice. */
  bookingStatus: string | null;
  /** Maintained "still owed" counter on the booking (ancillary charges). */
  balanceDue: number | null;
  /** Issued invoice total, GST-inclusive (immutable once SENT). */
  totalAmount: number;
  /** Non-void, non-deleted adjustment notes against this invoice. */
  adjustments: { type: "INCREASE" | "DECREASE"; totalAmount: number }[];
}

/** A grouped `(bookingId, type)` sum of SUCCEEDED payments. */
export interface PaymentGroup {
  bookingId: string | null;
  type: PaymentType;
  amount: number;
}

export interface InvoiceReconciliation {
  /** Signed adjustment-note delta: INCREASE adds, DECREASE subtracts. */
  adjustmentTotal: number;
  /** True consideration = totalAmount + adjustmentTotal. */
  netTotal: number;
  /** Net cash collected for the invoice's booking. */
  collected: number;
  /**
   * Amount still collectible. For a closed booking (see
   * {@link TERMINAL_BOOKING_STATUSES}) this is the booking's `balanceDue` — the
   * booking is done, so document face value no longer implies an amount owed.
   * For a live or standalone invoice it's `netTotal − collected`.
   */
  outstanding: number;
}

/**
 * Net cash collected per booking from grouped SUCCEEDED payments. Refunds and
 * credits subtract; bond holds/releases carry zero weight. Keyed by bookingId.
 */
export function netCashByBooking(groups: PaymentGroup[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of groups) {
    if (!g.bookingId) continue;
    const weight = paymentNetWeight(g.type);
    if (weight === 0) continue;
    map.set(g.bookingId, (map.get(g.bookingId) ?? 0) + weight * g.amount);
  }
  return map;
}

/** Reconcile one invoice against its adjustment notes and booking cash. */
export function reconcileInvoice(
  invoice: ReconcileInvoiceInput,
  netByBooking: Map<string, number>,
): InvoiceReconciliation {
  const adjustmentTotal = invoice.adjustments.reduce(
    (acc, a) => acc + (a.type === "INCREASE" ? a.totalAmount : -a.totalAmount),
    0,
  );
  const netTotal = roundCents(invoice.totalAmount + adjustmentTotal).toNumber();
  const collected = roundCents(
    invoice.bookingId ? (netByBooking.get(invoice.bookingId) ?? 0) : 0,
  ).toNumber();
  const isClosed =
    !!invoice.bookingStatus && TERMINAL_BOOKING_STATUSES.has(invoice.bookingStatus);
  const outstanding = isClosed
    ? roundCents(invoice.balanceDue ?? 0).toNumber()
    : roundCents(netTotal - collected).toNumber();
  return {
    adjustmentTotal: roundCents(adjustmentTotal).toNumber(),
    netTotal,
    collected,
    outstanding,
  };
}
