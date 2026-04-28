import { Text, Section, Button } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type MagicLinkProps = {
  /** The signed callback URL that logs the user in when visited. */
  url: string;
  /** Minutes until the link expires (shown in the email body). */
  expiresInMinutes: number;
  /** Masked email for the preview (the full recipient is in the envelope). */
  email: string;
  /** Public-facing brand name injected by the sender from branding settings. */
  siteName: string;
};

export default function MagicLinkEmail(p: MagicLinkProps) {
  return (
    <EmailLayout
      preview={`Your ${p.siteName} sign-in link — expires in ${p.expiresInMinutes} minutes`}
      heading={`Sign in to ${p.siteName}`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Someone (hopefully you) requested a sign-in link for{" "}
        <strong>{p.email}</strong>. Click the button below within the next{" "}
        <strong>{p.expiresInMinutes} minutes</strong> to sign in. No password
        needed.
      </Text>

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.url}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "12px 28px",
            borderRadius: 6,
            fontSize: 15,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Sign in to {p.siteName}
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
          Didn&apos;t request this? You can safely ignore the email — someone
          may have typed your address by mistake. Your account stays locked
          until the link is clicked.
        </Text>
      </Section>
    </EmailLayout>
  );
}
