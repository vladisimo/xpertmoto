import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type SupportTicketAssignedProps = {
  ticketNumber: string;
  category: string;
  priority: string;
  customerName: string;
  summary: string;
  description: string;
  depotName: string;
  portalUrl: string;
};

export default function SupportTicketAssigned(p: SupportTicketAssignedProps) {
  return (
    <EmailLayout
      preview={`Support ticket ${p.ticketNumber} assigned — ${p.summary}`}
      heading={`New support ticket · ${p.ticketNumber}`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        A new {p.category.toLowerCase().replace(/_/g, " ")} ticket from{" "}
        <strong>{p.customerName}</strong> has landed in your queue at {p.depotName}.
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
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
          Summary
        </Text>
        <Text style={{ fontSize: 14, fontWeight: 600, margin: "2px 0 12px", color: EMAIL_COLORS.textPrimary }}>
          {p.summary}
        </Text>
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
          Priority
        </Text>
        <Text style={{ fontSize: 14, margin: "2px 0 12px", color: EMAIL_COLORS.textPrimary }}>
          {p.priority}
        </Text>
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
          Customer description
        </Text>
        <Text style={{ fontSize: 14, margin: "2px 0", whiteSpace: "pre-wrap", color: EMAIL_COLORS.textPrimary }}>
          {p.description}
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
          Open ticket
        </Button>
      </Section>
    </EmailLayout>
  );
}
