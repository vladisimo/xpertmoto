import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type CustomerWelcomeProps = {
  customerName: string;
  siteName: string;
  /** Public app URL for the "browse fleet" CTA. */
  fleetUrl: string;
  /** Sign-in URL (also where the customer can use "Forgot password" to set their own password). */
  signInUrl: string;
};

export default function CustomerWelcome(p: CustomerWelcomeProps) {
  return (
    <EmailLayout
      preview={`Welcome to ${p.siteName}`}
      heading={`Welcome aboard, ${p.customerName}!`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Your {p.siteName} account has been created by our team. You can now
        browse our fleet, manage upcoming rentals, and receive booking
        confirmations directly to this inbox.
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
          <strong>Setting up online access:</strong> use the &ldquo;Forgot
          password&rdquo; link on the sign-in page to set your own password.
          You&apos;ll then be able to view bookings, download tax invoices, and
          extend rentals directly from the customer portal.
        </Text>
      </Section>

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.fleetUrl}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Browse the fleet
        </Button>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 20, lineHeight: 1.5 }}>
        Already booked? Sign in at{" "}
        <a href={p.signInUrl} style={{ color: EMAIL_COLORS.primary }}>
          {p.signInUrl.replace(/^https?:\/\//, "")}
        </a>{" "}
        to manage your rental.
      </Text>
    </EmailLayout>
  );
}
