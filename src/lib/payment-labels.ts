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
