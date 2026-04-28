import { Text, Section, Row, Column, Button } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BookingConfirmationProps = {
  customerName: string;
  bookingReference: string;
  categoryName: string;
  pickupDepotName: string;
  pickupDepotAddress: string;
  pickupDateTime: string;
  returnDateTime: string;
  durationDays: number;
  /** Already-formatted currency string (e.g. "A$420.00"). */
  totalAmount: string;
  /** Already-formatted currency string. */
  paidOnline: string;
  /** Already-formatted currency string, or null when nothing is owed at pickup. */
  dueAtPickup: string | null;
  /** Already-formatted currency string, or null when no bond was held. */
  bondAmount: string | null;
  /** Optional recurring-payment summary line for long-term hires. */
  recurringSummary?: string | null;
  portalUrl: string;
  siteName: string;
};

export default function BookingConfirmation(p: BookingConfirmationProps) {
  return (
    <EmailLayout
      preview={`Booking ${p.bookingReference} confirmed — pickup ${p.pickupDateTime}`}
      heading={`Your ride is locked in, ${p.customerName}!`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Thanks for booking with {p.siteName}. Your reference is{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong>.
        We&apos;ve attached your tax invoice
        {p.paidOnline !== "A$0.00" ? " and payment receipt" : ""} to this email
        for your records.
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
        <Row>
          <Column>
            <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
              Vehicle
            </Text>
            <Text style={{ fontSize: 14, fontWeight: 600, margin: "2px 0 12px", color: EMAIL_COLORS.textPrimary }}>
              {p.categoryName}
            </Text>
            <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
              Duration
            </Text>
            <Text style={{ fontSize: 14, margin: "2px 0 12px", color: EMAIL_COLORS.textPrimary }}>
              {p.durationDays} day(s)
            </Text>
          </Column>
          <Column>
            <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
              Pickup
            </Text>
            <Text style={{ fontSize: 14, margin: "2px 0 12px", color: EMAIL_COLORS.textPrimary }}>
              {p.pickupDateTime}
            </Text>
            <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
              Return
            </Text>
            <Text style={{ fontSize: 14, margin: "2px 0 12px", color: EMAIL_COLORS.textPrimary }}>
              {p.returnDateTime}
            </Text>
          </Column>
        </Row>
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: "12px 0 0" }}>
          Depot
        </Text>
        <Text style={{ fontSize: 14, margin: "2px 0", color: EMAIL_COLORS.textPrimary }}>
          <strong>{p.pickupDepotName}</strong>
          <br />
          {p.pickupDepotAddress}
        </Text>
      </Section>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.warningSurface,
          borderLeft: `4px solid ${EMAIL_COLORS.secondary}`,
          padding: 12,
          marginTop: 16,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.warningText, lineHeight: 1.6 }}>
          <strong>Total rental:</strong> {p.totalAmount}
          <br />
          <strong>Paid online:</strong> {p.paidOnline}
          {p.dueAtPickup ? (
            <>
              <br />
              <strong>Due at pickup:</strong> {p.dueAtPickup}
            </>
          ) : null}
          {p.bondAmount ? (
            <>
              <br />
              <strong>Bond hold:</strong> {p.bondAmount} (released within 14 days of return)
            </>
          ) : null}
        </Text>
      </Section>

      {p.recurringSummary ? (
        <Section
          style={{
            backgroundColor: EMAIL_COLORS.successSurface,
            border: `1px solid ${EMAIL_COLORS.successBorder}`,
            borderRadius: 6,
            padding: 12,
            marginTop: 16,
          }}
        >
          <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.successText, lineHeight: 1.6 }}>
            {p.recurringSummary}
          </Text>
        </Section>
      ) : null}

      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, marginTop: 16 }}>
        Please bring your valid driver&apos;s licence and the card used for payment. We&apos;ll see you at pickup!
      </Text>

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
          View booking in portal
        </Button>
      </Section>
    </EmailLayout>
  );
}
