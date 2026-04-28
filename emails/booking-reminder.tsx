import { Text, Section } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BookingReminderProps = {
  customerName: string;
  bookingReference: string;
  pickupDepotName: string;
  pickupDepotAddress: string;
  pickupDateTime: string;
  categoryName: string;
  siteName: string;
};

export default function BookingReminder(p: BookingReminderProps) {
  return (
    <EmailLayout
      preview={`Pickup tomorrow at ${p.pickupDepotName}`}
      heading={`See you tomorrow, ${p.customerName}!`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Friendly reminder that your {p.siteName} booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong> begins tomorrow.
      </Text>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.surface,
          border: `1px solid ${EMAIL_COLORS.border}`,
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.textPrimary, lineHeight: 1.7 }}>
          <strong>Vehicle:</strong> {p.categoryName}
          <br />
          <strong>Pickup:</strong> {p.pickupDateTime}
          <br />
          <strong>Depot:</strong> {p.pickupDepotName} — {p.pickupDepotAddress}
        </Text>
      </Section>

      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, marginTop: 16 }}>
        Please bring: a valid driver&apos;s licence, the card used for payment, and enclosed shoes. We&apos;ll handle helmets and gear.
      </Text>
    </EmailLayout>
  );
}
