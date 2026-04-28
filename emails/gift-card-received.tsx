import { Text, Section, Button } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type GiftCardReceivedProps = {
  recipientName: string;
  amount: string;
  code: string;
  personalMessage?: string;
  redeemUrl: string;
  siteName: string;
};

export default function GiftCardReceivedEmail(p: GiftCardReceivedProps) {
  return (
    <EmailLayout
      preview={`A ${p.amount} ${p.siteName} gift card just landed.`}
      heading={`🎁 You've been gifted a ride, ${p.recipientName}`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Someone has sent you a <strong>{p.amount}</strong> {p.siteName} gift card — redeemable
        against any scooter rental, addon, or insurance upgrade.
      </Text>

      {p.personalMessage ? (
        <Section
          style={{
            backgroundColor: EMAIL_COLORS.successSurface,
            borderLeft: `4px solid ${EMAIL_COLORS.primary}`,
            padding: 16,
            borderRadius: 6,
            marginTop: 16,
            fontStyle: "italic",
          }}
        >
          <Text style={{ fontSize: 14, color: EMAIL_COLORS.successText, margin: 0 }}>
            &ldquo;{p.personalMessage}&rdquo;
          </Text>
        </Section>
      ) : null}

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.surface,
          border: `2px dashed ${EMAIL_COLORS.primary}`,
          borderRadius: 8,
          padding: 24,
          marginTop: 24,
          textAlign: "center",
        }}
      >
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
          Your gift card code
        </Text>
        <Text
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: EMAIL_COLORS.primary,
            letterSpacing: 2,
            margin: "8px 0 0",
            fontFamily: "monospace",
          }}
        >
          {p.code}
        </Text>
      </Section>

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.redeemUrl}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Browse scooters &amp; ride
        </Button>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, marginTop: 24 }}>
        Apply your code at checkout. Valid for 3 years from issue date.
      </Text>
    </EmailLayout>
  );
}
