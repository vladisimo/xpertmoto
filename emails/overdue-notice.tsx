import { Text, Section } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type OverdueNoticeProps = {
  customerName: string;
  bookingReference: string;
  expectedReturn: string;
  lateFeePerHour: string;
};

export default function OverdueNotice(p: OverdueNoticeProps) {
  return (
    <EmailLayout
      preview={`Booking ${p.bookingReference} is now overdue`}
      heading="Your rental is overdue"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, our records show that booking{" "}
        <strong style={{ color: EMAIL_COLORS.errorText }}>{p.bookingReference}</strong> was due to be returned at{" "}
        <strong>{p.expectedReturn}</strong>, but we haven&apos;t received the vehicle yet.
      </Text>
      <Section
        style={{
          backgroundColor: EMAIL_COLORS.errorSurface,
          borderLeft: `4px solid ${EMAIL_COLORS.errorText}`,
          padding: 12,
          marginTop: 16,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.errorText, lineHeight: 1.5 }}>
          A late fee of <strong>{p.lateFeePerHour}/hour</strong> now applies, capped at the daily rate per 24-hour period. Please return the vehicle as soon as possible to avoid further charges or bond forfeit.
        </Text>
      </Section>
      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, marginTop: 16 }}>
        If you&apos;re having difficulty returning the vehicle, please call us immediately on the number on your rental agreement.
      </Text>
    </EmailLayout>
  );
}
