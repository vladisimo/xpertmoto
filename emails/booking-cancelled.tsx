import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BookingCancelledProps = {
  customerName: string;
  bookingReference: string;
  /** Already-formatted currency string (e.g. "A$120.00"), or null when no refund applies. */
  refundAmount: string | null;
  /** Whole-number percent (100, 50, 0). */
  refundPct: number;
  /** Already-formatted currency string, or null when no admin fee was charged. */
  adminFee: string | null;
  /** Already-formatted currency string, or null when no bond was held. */
  bondReleasedAmount: string | null;
  reason: string;
  /** "you" for customer-initiated, "our team" for staff-initiated. */
  cancelledBy: string;
};

export default function BookingCancelled(p: BookingCancelledProps) {
  const refundLine =
    p.refundAmount !== null
      ? `Refund: ${p.refundAmount} (${p.refundPct}% less ${p.adminFee ?? "admin fee"}). Funds return to your card within 5–10 business days.`
      : "No refund applies — cancellation was inside the no-refund window.";
  return (
    <EmailLayout
      preview={`Booking ${p.bookingReference} cancelled`}
      heading="Booking cancelled"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong> has been
        cancelled by {p.cancelledBy}.
      </Text>
      <Section
        style={{
          backgroundColor:
            p.refundAmount !== null ? EMAIL_COLORS.successSurface : EMAIL_COLORS.warningSurface,
          border: `1px solid ${
            p.refundAmount !== null ? EMAIL_COLORS.successBorder : EMAIL_COLORS.warningBorder
          }`,
          borderRadius: 6,
          padding: 16,
          margin: "16px 0",
        }}
      >
        <Text
          style={{
            fontSize: 14,
            color:
              p.refundAmount !== null ? EMAIL_COLORS.successText : EMAIL_COLORS.warningText,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {refundLine}
        </Text>
        {p.bondReleasedAmount && (
          <Text
            style={{
              fontSize: 13,
              color: EMAIL_COLORS.textPrimary,
              margin: "10px 0 0",
              lineHeight: 1.5,
            }}
          >
            Your bond hold of <strong>{p.bondReleasedAmount}</strong> has been released.
            Depending on your bank, funds may take 3–5 business days to appear.
          </Text>
        )}
      </Section>
      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, margin: "12px 0" }}>
        <strong>Reason on file:</strong> {p.reason}
      </Text>
      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20 }}>
        Changed your mind? You can make a fresh booking any time. If anything looks off,
        reply to this email and our team will sort it out.
      </Text>
    </EmailLayout>
  );
}
