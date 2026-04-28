import { Text, Section, Button } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type PasswordResetProps = {
  url: string;
  expiresInMinutes: number;
  email: string;
  siteName?: string;
};

export default function PasswordResetEmail(p: PasswordResetProps) {
  const siteName = p.siteName ?? "XPERT Moto";
  return (
    <EmailLayout
      preview={`Reset your ${siteName} password — expires in ${p.expiresInMinutes} minutes`}
      heading="Reset your password"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        A password reset was requested for <strong>{p.email}</strong>. Click
        the button below within the next{" "}
        <strong>{p.expiresInMinutes} minutes</strong> to set a new password.
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
          Choose a new password
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
          Didn&apos;t request this? You can safely ignore this email — your
          password won&apos;t change unless you click the link.
        </Text>
      </Section>
    </EmailLayout>
  );
}
