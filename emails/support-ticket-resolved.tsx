import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type SupportTicketResolvedProps = {
  ticketNumber: string;
  customerName: string;
  summary: string;
  feedbackUrl: string;
  siteName: string;
};

export default function SupportTicketResolved(p: SupportTicketResolvedProps) {
  return (
    <EmailLayout
      preview={`Your ${p.siteName} ticket ${p.ticketNumber} is resolved`}
      heading={`Thanks, ${p.customerName} — we've closed out your ticket`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Ticket <strong>{p.ticketNumber}</strong> ({p.summary}) has been resolved. If
        anything is still outstanding, just reply from the customer portal and we&apos;ll
        reopen it.
      </Text>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.successSurface,
          borderLeft: `4px solid ${EMAIL_COLORS.primary}`,
          padding: 16,
          marginTop: 20,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.successText }}>
          How did we do? Your rating helps us improve support for everyone.
        </Text>
      </Section>

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.feedbackUrl}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Leave feedback
        </Button>
      </Section>
    </EmailLayout>
  );
}
