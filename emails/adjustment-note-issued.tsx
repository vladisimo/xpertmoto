import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type AdjustmentNoteIssuedProps = {
  customerName: string;
  /** Adjustment note number (e.g. ADJ-2026-000123). */
  adjustmentNumber: string;
  /** "credit" for DECREASE, "debit" for INCREASE — drives the headline copy. */
  direction: "credit" | "debit";
  /** Reason category (DAMAGE / REFUND / etc.) — drives the explanatory paragraph. */
  reason: string;
  /** Already-formatted currency string. Always positive. */
  totalAmount: string;
  /** Optional booking reference for context. Null for non-booking adjustments. */
  bookingReference: string | null;
  /** Original invoice number this adjustment is against. */
  originalInvoiceNumber: string;
  /** Free-text description that came from the issuing call site. */
  description: string;
};

function explanation(reason: string, direction: "credit" | "debit"): string {
  // Reason-aware single paragraph so the customer understands the charge or
  // credit before they open the PDF.
  switch (reason) {
    case "EXTENSION":
      return "This covers the extra rental days you requested. The amount is charged at the rate that was current at the time you extended.";
    case "DAMAGE":
      return "This covers damage recorded against the vehicle at return. Itemised on the attached note. Talk to us if anything looks off.";
    case "LATE_FEE":
      return "The vehicle was returned past the agreed time, beyond the grace period. Late fees are charged hourly at one-eighth of the daily rate.";
    case "FUEL":
      return "Fuel was below the level it was handed over at. We've charged the shortfall at the per-litre rate from your terms.";
    case "CLEANING":
      return "Additional cleaning was required to return the vehicle to ready condition.";
    case "ZONE_SURCHARGE":
      return "The booking was used outside the agreed zone — this surcharge covers that period.";
    case "INFRINGEMENT":
      return "We've passed through a traffic / parking infringement that we received and nominated to your hire period.";
    case "CANCELLATION":
      return direction === "credit"
        ? "This is the refund for your cancellation, calculated against our cancellation policy."
        : "This is the cancellation fee per the policy you accepted at booking.";
    case "REFUND":
      return "This is a refund credited back to your original payment method. It can take 5–10 business days to land depending on your bank.";
    case "SWAP":
      return "This covers the difference from a vehicle swap during your booking.";
    case "MANUAL":
    case "OTHER":
    default:
      return direction === "credit"
        ? "A credit has been issued against your booking. See the attached adjustment note for the itemised detail."
        : "An additional charge has been recorded against your booking. See the attached adjustment note for the itemised detail.";
  }
}

export default function AdjustmentNoteIssued(p: AdjustmentNoteIssuedProps) {
  const isCredit = p.direction === "credit";
  return (
    <EmailLayout
      preview={`${isCredit ? "Credit" : "Charge"} on booking ${p.bookingReference ?? p.originalInvoiceNumber}`}
      heading={isCredit ? "Credit issued" : "Adjustment to your booking"}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, we&apos;ve issued an adjustment note against your
        {p.bookingReference ? (
          <>
            {" "}booking{" "}
            <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong>.
          </>
        ) : (
          <> account.</>
        )}{" "}
        The PDF is attached.
      </Text>

      <Section
        style={{
          backgroundColor: isCredit ? EMAIL_COLORS.successSurface : EMAIL_COLORS.warningSurface,
          border: `1px solid ${isCredit ? EMAIL_COLORS.successBorder : EMAIL_COLORS.warningBorder}`,
          borderRadius: 6,
          padding: 12,
          marginTop: 16,
        }}
      >
        <Text
          style={{
            fontSize: 13,
            margin: 0,
            color: isCredit ? EMAIL_COLORS.successText : EMAIL_COLORS.warningText,
            lineHeight: 1.6,
          }}
        >
          <strong>{isCredit ? "Credit" : "Charge"} amount:</strong> {p.totalAmount}
          <br />
          <strong>Adjustment number:</strong> {p.adjustmentNumber}
          <br />
          <strong>Original invoice:</strong> {p.originalInvoiceNumber}
        </Text>
      </Section>

      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textPrimary, marginTop: 16, lineHeight: 1.6 }}>
        <strong>What this is:</strong> {p.description}
      </Text>
      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, marginTop: 12, lineHeight: 1.6 }}>
        {explanation(p.reason, p.direction)}
      </Text>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20, lineHeight: 1.5 }}>
        Adjustment notes are GST-compliant tax documents under ATO §29-75.
        They sit alongside your original tax invoice in your records. If
        anything looks wrong, reply to this email and we&apos;ll have a look.
      </Text>
    </EmailLayout>
  );
}
