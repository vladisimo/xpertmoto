import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type VehicleSwapProps = {
  customerName: string;
  bookingReference: string;
  /** Human-readable description of the new vehicle, e.g. "Honda PCX 150 · 123-AB4". */
  incomingVehicleLabel: string;
  /** Reason category from the swap draft (already humanised — e.g. "mechanical fault"). */
  reason: string;
  /** "CHARGE" → customer is being charged the delta; "REFUND" → being refunded;
   * "NONE" → no price change. Drives the surface tone and copy. */
  direction: "CHARGE" | "REFUND" | "NONE";
  /** Already-formatted currency string. Null when direction is NONE. */
  deltaAmount: string | null;
  /** Already-formatted currency string. Null when there's no GST line to show. */
  gstAmount: string | null;
  /** True when the refund couldn't be returned to the original card and is being
   * settled by the finance team as account credit instead. */
  refundFallbackToCredit: boolean;
};

export default function VehicleSwap(p: VehicleSwapProps) {
  const isCharge = p.direction === "CHARGE";
  const isRefund = p.direction === "REFUND";
  const surfaceColor = isCharge
    ? EMAIL_COLORS.warningSurface
    : isRefund
      ? EMAIL_COLORS.successSurface
      : EMAIL_COLORS.surface;
  const borderColor = isCharge
    ? EMAIL_COLORS.warningBorder
    : isRefund
      ? EMAIL_COLORS.successBorder
      : EMAIL_COLORS.border;
  const textColor = isCharge
    ? EMAIL_COLORS.warningText
    : isRefund
      ? EMAIL_COLORS.successText
      : EMAIL_COLORS.textPrimary;
  return (
    <EmailLayout
      preview={`Vehicle swapped on booking ${p.bookingReference}`}
      heading="Your vehicle has been swapped"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong> has been
        moved to a different vehicle.
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
          New vehicle
        </Text>
        <Text style={{ fontSize: 14, fontWeight: 600, margin: "2px 0 12px", color: EMAIL_COLORS.textPrimary }}>
          {p.incomingVehicleLabel}
        </Text>
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
          Reason
        </Text>
        <Text style={{ fontSize: 14, margin: "2px 0", color: EMAIL_COLORS.textPrimary }}>
          {p.reason}
        </Text>
      </Section>

      {p.direction !== "NONE" && p.deltaAmount ? (
        <Section
          style={{
            backgroundColor: surfaceColor,
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            padding: 12,
            marginTop: 16,
          }}
        >
          <Text style={{ fontSize: 13, margin: 0, color: textColor, lineHeight: 1.6 }}>
            {isCharge ? (
              <>
                <strong>Additional charge:</strong> {p.deltaAmount}
                {p.gstAmount ? <> (GST {p.gstAmount})</> : null}. We&apos;ll
                charge this to your stored payment method.
              </>
            ) : (
              <>
                <strong>Refund:</strong> {p.deltaAmount}
                {p.gstAmount ? <> (GST {p.gstAmount})</> : null}.{" "}
                {p.refundFallbackToCredit
                  ? "Our finance team will reconcile this as account credit — we'll be in touch."
                  : "Funds return to your original payment method within 5–10 business days."}
              </>
            )}
          </Text>
        </Section>
      ) : null}

      {p.direction === "NONE" ? (
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, marginTop: 16 }}>
          No price change applies. Your booking total stays the same.
        </Text>
      ) : null}

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20, lineHeight: 1.5 }}>
        Any related GST adjustment notes will arrive in a separate email and
        are also available on your customer portal under Documents. If
        anything looks off, reply to this email and we&apos;ll have a look.
      </Text>
    </EmailLayout>
  );
}
