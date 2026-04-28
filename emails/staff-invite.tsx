import { Text, Section, Button } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type StaffInviteProps = {
  url: string;
  email: string;
  inviterName: string;
  roleLabel: string;
  expiresInHours: number;
  siteName?: string;
};

export default function StaffInviteEmail(p: StaffInviteProps) {
  const siteName = p.siteName ?? "XPERT Moto";
  return (
    <EmailLayout
      preview={`You've been invited to join ${siteName} — link expires in ${p.expiresInHours} hours`}
      heading={`Welcome to ${siteName}`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        <strong>{p.inviterName}</strong> has invited you to join {siteName} as a{" "}
        <strong>{p.roleLabel}</strong>. To accept the invitation and set up your
        account, click the button below within the next{" "}
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
          Accept invitation
        </Button>
      </Section>

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textMuted, lineHeight: 1.5, marginTop: 24 }}>
        If the button doesn&apos;t work, copy and paste this link into your
        browser:
        <br />
        <span style={{ wordBreak: "break-all", color: EMAIL_COLORS.primary }}>{p.url}</span>
      </Text>

      <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, lineHeight: 1.6, marginTop: 16 }}>
        You&apos;ll be asked to choose a password. Because staff accounts
        handle customer data, you&apos;ll also be asked to enrol in two-factor
        authentication before you can access the back-office.
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
          Didn&apos;t expect this invitation? You can safely ignore this email
          — the link will expire on its own and no account will be activated
          unless you click it.
        </Text>
      </Section>
    </EmailLayout>
  );
}
