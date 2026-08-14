import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BookingTerminatedProps = {
  customerName: string;
  bookingReference: string;
  /** Verb phrase for the vehicle, e.g. "was written off" / "was reported stolen". */
  causeLabel: string;
  /** Already-formatted en-AU date/time of the loss. */
  lossAt: string;
  unusedDays: number;
  refundMode: "REFUND" | "CREDIT" | "FORFEIT";
  /** Already-formatted currency (GST-inclusive), or null when nothing is returned. */
  refundAmount: string | null;
  /** True when the refund is recorded but delayed (retrying / manual transfer). */
  refundDelayed: boolean;
  /** Gift-card code when refundMode = CREDIT. */
  creditGiftCardCode: string | null;
  /** Already-formatted invoice write-down for the unused days, or null. */
  writedownAmount: string | null;
  /** Already-formatted late fees waived, or null when none. */
  waivedLateFees: string | null;
  /** Full sentence describing what happens to the bond. */
  bondLine: string;
};

export default function BookingTerminated(p: BookingTerminatedProps) {
  const refundApplies = p.refundMode !== "FORFEIT" && p.refundAmount !== null;
  let settlementLine: string;
  if (!refundApplies) {
    settlementLine =
      p.unusedDays > 0
        ? `Under your rental agreement, no refund applies for the ${p.unusedDays} unused day${p.unusedDays === 1 ? "" : "s"} of your hire.`
        : "Your hire had no unused days remaining, so no unused-days settlement applies.";
  } else if (p.refundMode === "CREDIT") {
    settlementLine = `We've credited ${p.refundAmount} (incl. GST) for the ${p.unusedDays} unused day${p.unusedDays === 1 ? "" : "s"} of your hire to a gift card you can use on any future booking.`;
  } else {
    settlementLine = p.refundDelayed
      ? `A refund of ${p.refundAmount} (incl. GST) for the ${p.unusedDays} unused day${p.unusedDays === 1 ? "" : "s"} of your hire has been recorded and is being processed — we'll be in touch if we need anything to complete it.`
      : `A refund of ${p.refundAmount} (incl. GST) for the ${p.unusedDays} unused day${p.unusedDays === 1 ? "" : "s"} of your hire is on its way to your original payment method. Funds usually appear within 5–10 business days.`;
  }

  return (
    <EmailLayout
      preview={`Booking ${p.bookingReference} has ended`}
      eyebrow="Booking update"
      heading="Your booking has ended"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, we're sorry to let you know that the vehicle on booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong>{" "}
        {p.causeLabel}, so your hire ended on {p.lossAt}.
      </Text>

      <Section
        style={{
          backgroundColor: refundApplies
            ? EMAIL_COLORS.successSurface
            : EMAIL_COLORS.warningSurface,
          border: `1px solid ${
            refundApplies ? EMAIL_COLORS.successBorder : EMAIL_COLORS.warningBorder
          }`,
          borderRadius: 6,
          padding: 16,
          margin: "16px 0",
        }}
      >
        <Text
          style={{
            fontSize: 14,
            color: refundApplies ? EMAIL_COLORS.successText : EMAIL_COLORS.warningText,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {settlementLine}
        </Text>
        {p.refundMode === "CREDIT" && p.creditGiftCardCode && (
          <Text
            style={{
              fontSize: 14,
              color: EMAIL_COLORS.textPrimary,
              margin: "10px 0 0",
              lineHeight: 1.5,
            }}
          >
            Gift card code:{" "}
            <strong style={{ letterSpacing: 1 }}>{p.creditGiftCardCode}</strong>
          </Text>
        )}
        {p.writedownAmount && (
          <Text
            style={{
              fontSize: 13,
              color: EMAIL_COLORS.textPrimary,
              margin: "10px 0 0",
              lineHeight: 1.5,
            }}
          >
            Your invoice has been adjusted down by <strong>{p.writedownAmount}</strong>{" "}
            (incl. GST) for the unused days — an adjustment note follows separately.
          </Text>
        )}
        {p.waivedLateFees && (
          <Text
            style={{
              fontSize: 13,
              color: EMAIL_COLORS.textPrimary,
              margin: "10px 0 0",
              lineHeight: 1.5,
            }}
          >
            Late fees of <strong>{p.waivedLateFees}</strong> have been waived.
          </Text>
        )}
      </Section>

      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, margin: "12px 0" }}>
        {p.bondLine}
      </Text>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20 }}>
        Need a replacement ride? Our team can help you into another vehicle — reply to
        this email or call your depot and we'll sort it out.
      </Text>
    </EmailLayout>
  );
}
