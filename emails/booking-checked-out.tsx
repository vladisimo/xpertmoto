import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type BookingCheckedOutProps = {
  customerName: string;
  bookingReference: string;
  vehicleLabel: string;
  /** Already-formatted date+time string. */
  pickupAt: string;
  /** Already-formatted date+time string. */
  expectedReturnAt: string;
  pickupOdometerKm: number;
  fuelLevel: number;
  staffName: string | null;
};

export default function BookingCheckedOut(p: BookingCheckedOutProps) {
  return (
    <EmailLayout
      preview={`You're on the road — booking ${p.bookingReference}`}
      heading={`You're on the road, ${p.customerName}!`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong>{" "}
        has been checked out. Your signed rental agreement is attached for your
        records — please keep a copy with you while riding.
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
          <strong>Vehicle:</strong> {p.vehicleLabel}
          <br />
          <strong>Picked up:</strong> {p.pickupAt}
          <br />
          <strong>Expected return:</strong> {p.expectedReturnAt}
          <br />
          <strong>Odometer at pickup:</strong> {p.pickupOdometerKm.toLocaleString("en-AU")} km
          <br />
          <strong>Fuel at pickup:</strong> {p.fuelLevel}%
          {p.staffName ? (
            <>
              <br />
              <strong>Handover by:</strong> {p.staffName}
            </>
          ) : null}
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
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.warningText, lineHeight: 1.5 }}>
          Return the vehicle by <strong>{p.expectedReturnAt}</strong> with a
          similar fuel level to avoid late and refuel charges. Need to extend?
          You can do that from the customer portal up until the return time.
        </Text>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20 }}>
        Ride safe. If anything goes wrong on the road, reply to this email or
        call your pickup depot — the number is on the rental agreement.
      </Text>
    </EmailLayout>
  );
}
