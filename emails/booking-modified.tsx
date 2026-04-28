import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BookingModifiedProps = {
  customerName: string;
  bookingReference: string;
  /** Human-readable previous return — e.g. "Sat 25 Apr, 10:00 AM". */
  previousReturn: string;
  newReturn: string;
  extensionDays: number;
  /** Already-formatted currency string. */
  extensionCharge: string;
};

export default function BookingModified(p: BookingModifiedProps) {
  return (
    <EmailLayout
      preview={`Booking ${p.bookingReference} extended by ${p.extensionDays} day${p.extensionDays === 1 ? "" : "s"}`}
      heading="Booking extended"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong> has been
        extended by {p.extensionDays} day{p.extensionDays === 1 ? "" : "s"}.
      </Text>
      <Section
        style={{
          backgroundColor: EMAIL_COLORS.surface,
          border: `1px solid ${EMAIL_COLORS.border}`,
          borderRadius: 6,
          padding: 16,
          margin: "16px 0",
        }}
      >
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, margin: "0 0 8px" }}>
          Previous return
        </Text>
        <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, margin: "0 0 16px" }}>
          {p.previousReturn}
        </Text>
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, margin: "0 0 8px" }}>
          New return
        </Text>
        <Text style={{ fontSize: 14, fontWeight: 600, color: EMAIL_COLORS.textPrimary, margin: 0 }}>
          {p.newReturn}
        </Text>
      </Section>
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, margin: "12px 0" }}>
        <strong>Extension charge:</strong> {p.extensionCharge}
      </Text>
      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20 }}>
        The extension has been priced at current daily rates. Return the vehicle by the new return
        time to avoid late fees.
      </Text>
    </EmailLayout>
  );
}
