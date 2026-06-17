import { Text, Section, Button } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type VerifyEmailProps = {
  url: string;
  expiresInHours: number;
  email: string;
  siteName?: string;
};

export default function VerifyEmail(p: VerifyEmailProps) {
  const siteName = p.siteName ?? "XPERT Moto";
  return (
    <EmailLayout
      preview={`Confirm your email to start booking with ${siteName}`}
      heading="Confirm your email"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Welcome to {siteName}! Confirm that <strong>{p.email}</strong> is your
        email address so you can book a hire. This link expires in{" "}
        <strong>{p.expiresInHours} hours</strong>.
      </Text>

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.url}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: EMAIL_COLORS.surface,
            padding: "12px 28px",
            borderRadius: 6,
            fontSize: 15,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Confirm my email
        </Button>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textMuted, lineHeight: 1.5, marginTop: 24 }}>
        If the button doesn&apos;t work, copy and paste this link into your
        browser:
        <br />
        <span style={{ wordBreak: "break-all", color: EMAIL_COLORS.primary }}>{p.url}</span>
      </Text>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.warningSurface,
          borderLeft: `4px solid ${EMAIL_COLORS.secondary}`,
          padding: 12,
          marginTop: 24,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.warningText }}>
          Didn&apos;t create a {siteName} account? You can safely ignore this
          email — no account is active until the address is confirmed.
        </Text>
      </Section>
    </EmailLayout>
  );
}
