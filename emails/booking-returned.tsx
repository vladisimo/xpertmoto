import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BookingReturnedProps = {
  customerName: string;
  bookingReference: string;
  /** Already-formatted date+time string. */
  returnedAt: string;
  returnOdometerKm: number;
  fuelLevel: number;
  /** Already-formatted currency string for any final balance owed by the
   * customer (covers late fees, fuel charges, confirmed damage). Null when
   * nothing is owed. */
  finalBalance: string | null;
  /** Already-formatted currency string. Null when no bond was held or when
   * release timing depends on quote-pending damage charges. */
  bondReleased: string | null;
  /** True when the assessment flagged QUOTE_PENDING damage that may lead to
   * additional charges once the work order is closed. */
  hasPendingQuote: boolean;
};

export default function BookingReturned(p: BookingReturnedProps) {
  const positive = p.finalBalance === null && !p.hasPendingQuote;
  return (
    <EmailLayout
      preview={`Booking ${p.bookingReference} returned — thanks for riding`}
      heading={`Returned — thanks for riding, ${p.customerName}!`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong>{" "}
        is checked back in. Your signed return assessment is attached
        {p.finalBalance !== null ? ", along with the adjustment note covering today's settlement" : ""}
        .
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
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.textPrimary, margin: 0, lineHeight: 1.7 }}>
          <strong>Returned:</strong> {p.returnedAt}
          <br />
          <strong>Odometer at return:</strong> {p.returnOdometerKm.toLocaleString("en-AU")} km
          <br />
          <strong>Fuel at return:</strong> {p.fuelLevel}%
        </Text>
      </Section>

      <Section
        style={{
          backgroundColor: positive ? EMAIL_COLORS.successSurface : EMAIL_COLORS.warningSurface,
          border: `1px solid ${positive ? EMAIL_COLORS.successBorder : EMAIL_COLORS.warningBorder}`,
          borderRadius: 6,
          padding: 12,
          marginTop: 16,
        }}
      >
        <Text
          style={{
            fontSize: 13,
            margin: 0,
            color: positive ? EMAIL_COLORS.successText : EMAIL_COLORS.warningText,
            lineHeight: 1.6,
          }}
        >
          {p.finalBalance !== null ? (
            <>
              <strong>Settlement at return:</strong> {p.finalBalance}. Details
              are itemised on the attached adjustment note.
            </>
          ) : (
            <>No additional charges — you&apos;re all squared away.</>
          )}
          {p.bondReleased ? (
            <>
              <br />
              <strong>Bond hold released:</strong> {p.bondReleased}. Funds
              typically reappear on your card within 3–5 business days.
            </>
          ) : null}
          {p.hasPendingQuote ? (
            <>
              <br />
              We&apos;ve noted some damage that&apos;s being quoted. We&apos;ll
              email you the final figure once the assessment is complete and
              keep the related bond hold in place until then.
            </>
          ) : null}
        </Text>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20 }}>
        Thanks for choosing us. We&apos;d love to hear how the ride went —
        we&apos;ll send a short feedback request in a couple of days.
      </Text>
    </EmailLayout>
  );
}
