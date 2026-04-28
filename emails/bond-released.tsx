import { Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BondReleasedProps = {
  customerName: string;
  bookingReference: string;
  amount: string;
  deductions?: string;
};

export default function BondReleased(p: BondReleasedProps) {
  return (
    <EmailLayout
      preview={`Bond of ${p.amount} released`}
      heading="Your bond has been released"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, the bond held for booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong> has been released back to your card.
      </Text>
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, margin: "12px 0" }}>
        <strong>Released amount:</strong> {p.amount}
      </Text>
      {p.deductions && (
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.warningAccentText }}>
          <strong>Deductions:</strong> {p.deductions}
        </Text>
      )}
      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, marginTop: 16 }}>
        Depending on your bank, the funds may take 3–5 business days to appear.
      </Text>
    </EmailLayout>
  );
}
