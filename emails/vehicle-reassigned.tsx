import { Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type VehicleReassignedProps = {
  customerName: string;
  bookingReference: string;
};

/**
 * Sent when a booking's assigned vehicle is removed from the fleet
 * (stolen / written off / decommissioned) and the booking was
 * auto-reassigned to another vehicle in the SAME category. Deliberately
 * brief: nothing about the customer's hire changes except the unit.
 */
export default function VehicleReassigned(p: VehicleReassignedProps) {
  return (
    <EmailLayout
      preview={`Vehicle updated on booking ${p.bookingReference}`}
      heading="Your vehicle has been updated"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, the vehicle assigned to booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong> has been
        updated to another vehicle in the same category.
      </Text>
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, margin: "12px 0", lineHeight: 1.6 }}>
        Nothing else changes — your dates, pickup location and price stay exactly the same.
        There is nothing you need to do.
      </Text>
      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, marginTop: 16, lineHeight: 1.5 }}>
        If you have any questions, just reply to this email and we&apos;ll help out.
      </Text>
    </EmailLayout>
  );
}
