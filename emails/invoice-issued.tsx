import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type InvoiceIssuedProps = {
  customerName: string;
  invoiceNumber: string;
  bookingReference: string;
  amount: string;
  dueDate: string;
  invoiceUrl: string;
};

export default function InvoiceIssued(p: InvoiceIssuedProps) {
  return (
    <EmailLayout
      preview={`Invoice ${p.invoiceNumber} — ${p.amount}`}
      heading={`Invoice ${p.invoiceNumber}`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, a new tax invoice has been issued for your booking{" "}
        <strong>{p.bookingReference}</strong>.
      </Text>
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, margin: "12px 0" }}>
        <strong>Total:</strong> {p.amount}
        <br />
        <strong>Due:</strong> {p.dueDate}
      </Text>
      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.invoiceUrl}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          View invoice
        </Button>
      </Section>
    </EmailLayout>
  );
}
