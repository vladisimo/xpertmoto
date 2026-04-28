import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type SupportTicketUrgentProps = {
  ticketNumber: string;
  category: string;
  priority: string;
  customerName: string;
  summary: string;
  description: string;
  depotName: string;
  portalUrl: string;
};

export default function SupportTicketUrgent(p: SupportTicketUrgentProps) {
  return (
    <EmailLayout
      preview={`URGENT: ${p.category} — ${p.ticketNumber}`}
      heading={`URGENT — ${p.ticketNumber}`}
    >
      <Section
        style={{
          backgroundColor: EMAIL_COLORS.errorSurface,
          borderLeft: `4px solid ${EMAIL_COLORS.errorText}`,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.errorText }}>
          <strong>This ticket is marked URGENT.</strong> Please respond as soon as
          possible — a customer may be stranded or blocked.
        </Text>
      </Section>

      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        <strong>{p.customerName}</strong> has raised a{" "}
        {p.category.toLowerCase().replace(/_/g, " ")} at {p.depotName}.
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
        <Text style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", color: EMAIL_COLORS.textPrimary }}>
          {p.summary}
        </Text>
        <Text style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap", color: EMAIL_COLORS.textPrimary }}>
          {p.description}
        </Text>
      </Section>

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.portalUrl}
          style={{
            backgroundColor: EMAIL_COLORS.errorText,
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Respond now
        </Button>
      </Section>
    </EmailLayout>
  );
}
