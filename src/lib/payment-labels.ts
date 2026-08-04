import type { PaymentType } from "@prisma/client";

/**
 * Customer-facing labels for `PaymentType`. Used on the customer
 * portal (lowercase phrases that read well inside a sentence — e.g.
 * "your late return fee of $42") and as the fallback when a UI needs
 * a friendly label rather than the raw enum.
 */
export const PAYMENT_TYPE_LABELS_CUSTOMER: Partial<Record<PaymentType, string>> = {
  LATE_FEE: "late return fee",
  FUEL_CHARGE: "fuel charge",
  DAMAGE_CHARGE: "damage charge",
  INFRINGEMENT_RECOVERY: "infringement recovery",
  MANUAL_CHARGE: "manual charge",
  EXTENSION: "booking extension",
  CLEANING_FEE: "cleaning fee",
  SUBSCRIPTION_CHARGE: "subscription charge",
  BOOKING_PAYMENT: "booking balance",
  ADDON_CHARGE: "add-on charge",
  ZONE_SURCHARGE: "zone surcharge",
  FUEL_DELIVERY_FEE: "fuel delivery fee",
  SWAP_ADJUSTMENT: "vehicle-swap adjustment",
};

/**
 * Title-Case labels for staff/admin tables and statements.
 */
export const PAYMENT_TYPE_LABELS_STAFF: Record<PaymentType, string> = {
  BOOKING_PAYMENT: "Booking Payment",
  BOND_HOLD: "Bond Hold",
  BOND_CAPTURE: "Bond Capture",
  BOND_RELEASE: "Bond Release",
  REFUND: "Refund",
  DAMAGE_CHARGE: "Damage Charge",
  LATE_FEE: "Late Fee",
  FUEL_CHARGE: "Fuel Charge",
  ADDON_CHARGE: "Add-on Charge",
  EXTENSION: "Extension",
  INFRINGEMENT_RECOVERY: "Infringement Recovery",
  CLEANING_FEE: "Cleaning Fee",
  SUBSCRIPTION_CHARGE: "Subscription Charge",
  MANUAL_CHARGE: "Manual Charge",
  MANUAL_CREDIT: "Manual Credit",
  ZONE_SURCHARGE: "Zone Surcharge",
  FUEL_DELIVERY_FEE: "Fuel Delivery Fee",
  SWAP_ADJUSTMENT: "Swap Adjustment",
  GIFT_CARD_PURCHASE: "Gift Card Purchase",
  GIFT_CARD_REDEMPTION: "Gift Card Redemption",
  PARTNER_COMMISSION_PAYOUT: "Partner Commission Payout",
};

export function paymentTypeLabel(t: PaymentType): string {
  return (
    PAYMENT_TYPE_LABELS_CUSTOMER[t] ?? t.replace(/_/g, " ").toLowerCase()
  );
}

/**
 * Payment types that represent ancillary charges levied on a booking
 * AFTER the initial booking payment — used by the customer portal to
 * decide whether to render an "Additional charges" panel and by staff
 * dashboards to compute outstanding balance owed by the customer.
 *
 * Excludes: BOOKING_PAYMENT (initial), BOND_*, REFUND (negative), and
 * MANUAL_CREDIT.
 */
export const POST_RENTAL_CHARGE_TYPES: ReadonlyArray<PaymentType> = [
  "LATE_FEE",
  "FUEL_CHARGE",
  "DAMAGE_CHARGE",
  "INFRINGEMENT_RECOVERY",
  "MANUAL_CHARGE",
  "CLEANING_FEE",
  "EXTENSION",
  "ADDON_CHARGE",
  "ZONE_SURCHARGE",
  "FUEL_DELIVERY_FEE",
  "SWAP_ADJUSTMENT",
  "SUBSCRIPTION_CHARGE",
];

export function isPostRentalCharge(t: PaymentType): boolean {
  return POST_RENTAL_CHARGE_TYPES.includes(t);
}

/**
 * Payment types that move real money OUT of the business. Every
 * `Payment.amount` is stored as a positive Decimal — the direction lives in
 * the `type`, not the sign — so any cash/revenue total that sums amounts must
 * apply this sign or it double-counts refunds as income.
 *
 * Intentionally broader than the invoice-document `DECREASE_TYPES`
 * ({REFUND, MANUAL_CREDIT}) in invoice-generate.ts: a partner payout never
 * touches a customer invoice, but it does send cash out, so on a finance
 * ledger it belongs here.
 *
 * GIFT_CARD_REDEMPTION lives in PAYMENT_NONCASH_TYPES below: the funding
 * CASH was booked at GIFT_CARD_PURCHASE, so a redemption moves no cash —
 * its old +1 weight on a negative stored amount silently SUBTRACTED
 * redeemed value from every cash total. (GST is separate: computeGstSummary
 * books redemption GST into G1/1A directly, per Div 100.)
 */
export const PAYMENT_OUTFLOW_TYPES: ReadonlySet<PaymentType> = new Set<PaymentType>([
  "REFUND",
  "MANUAL_CREDIT",
  "PARTNER_COMMISSION_PAYOUT",
]);

/**
 * Bond hold/release are Stripe *authorisations* (capture_method=manual), not
 * cash: a hold places a temporary authorisation on the customer's card and a
 * release cancels it — neither moves money through the business's account. So
 * they carry ZERO weight on a cash/revenue total. (The hold isn't even
 * written as a Payment row — it lives only in BondLedger — so a release would
 * otherwise show up as a lone, unmatched outflow and skew the net.)
 *
 * BOND_CAPTURE is deliberately NOT here: capturing a held bond (damage /
 * no-show) is the moment authorised funds become real money in.
 */
export const PAYMENT_NONCASH_TYPES: ReadonlySet<PaymentType> = new Set<PaymentType>([
  "BOND_HOLD",
  "BOND_RELEASE",
  // Voucher redemption: the cash was booked at GIFT_CARD_PURCHASE.
  "GIFT_CARD_REDEMPTION",
]);

/** True for bond authorisations (hold/release) — shown as rows but excluded from any cash total. */
export function isNonCashPayment(t: PaymentType): boolean {
  return PAYMENT_NONCASH_TYPES.has(t);
}

/**
 * Weight of a payment on a cash/revenue total: +1 money in, -1 money out,
 * 0 for non-cash bond authorisations. Use this — never a plain SUM — whenever
 * summing `Payment.amount` or `Payment.gstAmount` into a net figure.
 */
export function paymentNetWeight(t: PaymentType): -1 | 0 | 1 {
  if (PAYMENT_NONCASH_TYPES.has(t)) return 0;
  return PAYMENT_OUTFLOW_TYPES.has(t) ? -1 : 1;
}

/**
 * Amount for display: negative for cash outflows (refunds/credits/payouts),
 * positive magnitude for inflows and for non-cash bond rows (which read as a
 * neutral "$300 released" line, and are excluded from totals via
 * `paymentNetWeight`). Callers that sum into a net MUST weight by
 * `paymentNetWeight`, not by this value.
 */
export function signedPaymentAmount(t: PaymentType, amount: number): number {
  if (PAYMENT_NONCASH_TYPES.has(t)) return amount;
  // `+ 0` normalises -0 (from negating a zero amount) so it formats as "$0.00".
  return (PAYMENT_OUTFLOW_TYPES.has(t) ? -amount : amount) + 0;
}
