import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type SupportTicketCustomerReplyProps = {
  ticketNumber: string;
  customerName: string;
  replyBody: string;
  portalUrl: string;
};

export default function SupportTicketCustomerReply(p: SupportTicketCustomerReplyProps) {
  return (
    <EmailLayout
      preview={`Our team replied on ${p.ticketNumber}`}
      heading={`You've got a reply, ${p.customerName}`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Our support team has responded on your ticket{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.ticketNumber}</strong>:
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
        <Text style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap", color: EMAIL_COLORS.textPrimary }}>
          {p.replyBody}
        </Text>
      </Section>

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.portalUrl}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Continue the conversation
        </Button>
      </Section>
    </EmailLayout>
  );
}
