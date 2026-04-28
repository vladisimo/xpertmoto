import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type DebtReminderProps = {
  customerName: string;
  /** Already-formatted currency string. */
  totalOwed: string;
  /** Already-formatted currency string. Null when this stream has nothing owed. */
  bookingDebt: string | null;
  invoiceDebt: string | null;
  infringementDebt: string | null;
  /** Customer-portal URL for paying outstanding balances. */
  portalUrl: string;
  siteName: string;
};

export default function DebtReminder(p: DebtReminderProps) {
  const breakdown: Array<{ label: string; amount: string }> = [];
  if (p.bookingDebt) breakdown.push({ label: "Open bookings", amount: p.bookingDebt });
  if (p.invoiceDebt) breakdown.push({ label: "Overdue invoices", amount: p.invoiceDebt });
  if (p.infringementDebt)
    breakdown.push({ label: "Tolls / infringements", amount: p.infringementDebt });

  return (
    <EmailLayout
      preview={`${p.totalOwed} outstanding on your ${p.siteName} account`}
      heading="Outstanding balance reminder"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, our records show you have an outstanding balance
        with {p.siteName}.
      </Text>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.warningSurface,
          border: `1px solid ${EMAIL_COLORS.warningBorder}`,
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
          textAlign: "center",
        }}
      >
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.warningAccentText, textTransform: "uppercase", margin: 0 }}>
          Total outstanding
        </Text>
        <Text
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: EMAIL_COLORS.warningAccentText,
            margin: "4px 0 0",
          }}
        >
          {p.totalOwed}
        </Text>
      </Section>

      {breakdown.length > 0 ? (
        <Section
          style={{
            backgroundColor: EMAIL_COLORS.surface,
            border: `1px solid ${EMAIL_COLORS.border}`,
            borderRadius: 8,
            padding: 0,
            marginTop: 16,
            overflow: "hidden",
          }}
        >
          <table cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {breakdown.map((b, idx) => (
                <tr key={b.label}>
                  <td
                    style={{
                      fontSize: 13,
                      color: EMAIL_COLORS.textPrimary,
                      padding: "10px 14px",
                      borderBottom:
                        idx === breakdown.length - 1
                          ? "none"
                          : `1px solid ${EMAIL_COLORS.border}`,
                    }}
                  >
                    {b.label}
                  </td>
                  <td
                    style={{
                      fontSize: 13,
                      color: EMAIL_COLORS.textPrimary,
                      padding: "10px 14px",
                      textAlign: "right",
                      fontWeight: 600,
                      borderBottom:
                        idx === breakdown.length - 1
                          ? "none"
                          : `1px solid ${EMAIL_COLORS.border}`,
                    }}
                  >
                    {b.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

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
          Settle balance
        </Button>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20, lineHeight: 1.5 }}>
        Believe this is in error? Reply to this email with the booking
        reference or invoice number and we&apos;ll review it. Persistent
        balances may delay future bookings.
      </Text>
    </EmailLayout>
  );
}
