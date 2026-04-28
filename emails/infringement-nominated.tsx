import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type InfringementNominatedProps = {
  customerName: string;
  bookingReference: string;
  referenceNumber: string;
  /** Human-readable infringement category (e.g. "Speeding", "Toll", "Parking"). */
  type: string;
  issuer: string;
  /** Already-formatted date string (en-AU). */
  offenceDate: string;
  /** Already-formatted currency string. */
  amount: string;
  /** Already-formatted date string for the issuer's due date, or null when unknown. */
  dueDate: string | null;
  /** Customer-portal deep-link to the infringement detail. */
  portalUrl: string;
  siteName: string;
};

export default function InfringementNominated(p: InfringementNominatedProps) {
  return (
    <EmailLayout
      preview={`Action required: ${p.type} infringement ${p.referenceNumber}`}
      heading="Infringement nominated to you"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, the {p.issuer.toLowerCase().includes("road") ? "" : ""}
        {p.issuer} has issued a {p.type.toLowerCase()} infringement that occurred
        during your hire on booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong>.
        We&apos;ve nominated this to you as the responsible driver.
      </Text>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.warningSurface,
          border: `1px solid ${EMAIL_COLORS.warningBorder}`,
          borderRadius: 8,
          padding: 0,
          marginTop: 16,
          overflow: "hidden",
        }}
      >
        <table cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td
                style={{
                  fontSize: 11,
                  color: EMAIL_COLORS.warningAccentText,
                  textTransform: "uppercase",
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.warningBorder}`,
                  width: "40%",
                }}
              >
                Reference
              </td>
              <td
                style={{
                  fontSize: 13,
                  color: EMAIL_COLORS.warningText,
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.warningBorder}`,
                  fontWeight: 600,
                }}
              >
                {p.referenceNumber}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  fontSize: 11,
                  color: EMAIL_COLORS.warningAccentText,
                  textTransform: "uppercase",
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.warningBorder}`,
                }}
              >
                Issuer
              </td>
              <td
                style={{
                  fontSize: 13,
                  color: EMAIL_COLORS.warningText,
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.warningBorder}`,
                }}
              >
                {p.issuer}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  fontSize: 11,
                  color: EMAIL_COLORS.warningAccentText,
                  textTransform: "uppercase",
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.warningBorder}`,
                }}
              >
                Offence date
              </td>
              <td
                style={{
                  fontSize: 13,
                  color: EMAIL_COLORS.warningText,
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.warningBorder}`,
                }}
              >
                {p.offenceDate}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  fontSize: 11,
                  color: EMAIL_COLORS.warningAccentText,
                  textTransform: "uppercase",
                  padding: "10px 14px",
                  borderBottom: p.dueDate ? `1px solid ${EMAIL_COLORS.warningBorder}` : "none",
                }}
              >
                Amount
              </td>
              <td
                style={{
                  fontSize: 16,
                  color: EMAIL_COLORS.warningAccentText,
                  padding: "10px 14px",
                  borderBottom: p.dueDate ? `1px solid ${EMAIL_COLORS.warningBorder}` : "none",
                  fontWeight: 700,
                }}
              >
                {p.amount}
              </td>
            </tr>
            {p.dueDate ? (
              <tr>
                <td
                  style={{
                    fontSize: 11,
                    color: EMAIL_COLORS.warningAccentText,
                    textTransform: "uppercase",
                    padding: "10px 14px",
                  }}
                >
                  Due by
                </td>
                <td
                  style={{
                    fontSize: 13,
                    color: EMAIL_COLORS.warningText,
                    padding: "10px 14px",
                    fontWeight: 600,
                  }}
                >
                  {p.dueDate}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
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
          View infringement &amp; pay
        </Button>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20, lineHeight: 1.5 }}>
        Your hire agreement makes you responsible for any infringements
        incurred during your booking. Pay directly through the customer
        portal — {p.siteName} doesn&apos;t add any handling fee on top.
        If you believe this was issued in error, contact the issuer
        ({p.issuer}) using the reference number above.
      </Text>
    </EmailLayout>
  );
}
