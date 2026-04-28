import { Text, Section } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type PaymentReceiptProps = {
  customerName: string;
  bookingReference: string;
  amount: string;
  paymentType: string;
  paidAt: string;
};

export default function PaymentReceipt(p: PaymentReceiptProps) {
  return (
    <EmailLayout
      preview={`Payment of ${p.amount} received`}
      heading="Payment received — thank you"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, we&apos;ve successfully processed your payment.
      </Text>
      <Section style={{ backgroundColor: EMAIL_COLORS.successSurface, border: `1px solid ${EMAIL_COLORS.successBorder}`, borderRadius: 8, padding: 16, marginTop: 16 }}>
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.successText }}>
          <strong>Amount:</strong> {p.amount}
          <br />
          <strong>Type:</strong> {p.paymentType}
          <br />
          <strong>Booking:</strong> {p.bookingReference}
          <br />
          <strong>Date:</strong> {p.paidAt}
        </Text>
      </Section>
      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 16 }}>
        This email serves as your tax receipt. GST is included in the amount shown (10%).
      </Text>
    </EmailLayout>
  );
}
