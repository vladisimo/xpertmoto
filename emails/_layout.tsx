import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "./tokens";
import { getEmailBrandingVars } from "@/lib/email-branding-vars";

/**
 * Shared shell for every React Email template. Kept visually in lockstep with
 * the string shell in `src/lib/email-shell.ts` (logo header, white card,
 * policy-link footer, mobile + dark-mode `@media` rules) so a customer can't
 * tell whether an email came from a React template or the generic wrap. Both
 * pull colours + font from `emails/tokens.ts`.
 */

// Mobile + dark-mode rules — mirrors the <style> block in email-shell.ts.
const STYLE = `
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
  a { color: ${EMAIL_COLORS.primary}; }
  @media only screen and (max-width: 600px) {
    .outer { padding: 12px !important; }
    .card { padding: 24px 20px !important; }
    h1 { font-size: 22px !important; }
    .summary td { font-size: 14px !important; }
    .cta a { padding: 14px 20px !important; font-size: 15px !important; }
  }
  @media (prefers-color-scheme: dark) {
    body.email-body { background: #151616 !important; }
    .card { background: #1E1F20 !important; color: #F3F3F2 !important; }
    .card h1, .card p, .card td { color: #F3F3F2 !important; }
    .card .muted { color: #B5B5B3 !important; }
    .card .subtle { color: #8E8E8C !important; }
  }
`;

export async function EmailLayout({
  preview,
  heading,
  eyebrow,
  cta,
  children,
}: {
  preview: string;
  heading: string;
  /** Small uppercase label above the heading (e.g. "Booking confirmed"). */
  eyebrow?: string;
  /** Optional primary call-to-action button under the body. */
  cta?: { label: string; url: string };
  children: ReactNode;
}) {
  const {
    siteName,
    legalName,
    abn,
    supportEmail,
    logoUrl,
    appUrl,
    termsUrl,
    privacyUrl,
    refundPolicyUrl,
    supportUrl,
    currentYear,
  } = await getEmailBrandingVars();

  return (
    <Html lang="en-AU">
      <Head>
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="email-body"
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: EMAIL_COLORS.background,
          fontFamily: EMAIL_FONT_STACK,
          color: EMAIL_COLORS.textPrimary,
        }}
      >
        <Container className="outer" style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px" }}>
          <Section style={{ padding: "0 0 16px 0" }}>
            {logoUrl ? (
              <Link href={appUrl} style={{ textDecoration: "none" }}>
                <Img
                  src={logoUrl}
                  alt={siteName}
                  height={36}
                  style={{ display: "block", border: 0, height: 36, width: "auto", maxWidth: 220 }}
                />
              </Link>
            ) : (
              <Text style={{ fontSize: 24, fontWeight: 700, color: EMAIL_COLORS.primary, margin: 0 }}>
                🛵 {siteName}
              </Text>
            )}
          </Section>

          <Section
            className="card"
            style={{
              backgroundColor: EMAIL_COLORS.surface,
              border: `1px solid ${EMAIL_COLORS.border}`,
              borderRadius: 12,
              padding: "32px 28px",
            }}
          >
            {eyebrow ? (
              <Text
                style={{
                  margin: "0 0 8px 0",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: EMAIL_COLORS.primary,
                }}
              >
                {eyebrow}
              </Text>
            ) : null}
            <Heading
              as="h1"
              style={{
                margin: "0 0 16px 0",
                fontSize: 26,
                lineHeight: 1.25,
                fontWeight: 700,
                color: EMAIL_COLORS.textPrimary,
              }}
            >
              {heading}
            </Heading>
            {children}
            {cta ? (
              <Section className="cta" style={{ textAlign: "center", margin: "28px 0 4px 0" }}>
                <Button
                  href={cta.url}
                  style={{
                    display: "inline-block",
                    backgroundColor: EMAIL_COLORS.primary,
                    color: "#ffffff",
                    padding: "14px 28px",
                    fontSize: 16,
                    fontWeight: 600,
                    textDecoration: "none",
                    borderRadius: 8,
                  }}
                >
                  {cta.label}
                </Button>
              </Section>
            ) : null}
          </Section>

          <Section style={{ padding: "24px 4px 8px 4px" }}>
            <Text style={{ margin: "0 0 8px 0", fontSize: 12, lineHeight: 1.6, color: EMAIL_COLORS.textMuted }}>
              <Link href={termsUrl} style={{ color: EMAIL_COLORS.textMuted, textDecoration: "underline" }}>
                Terms of service
              </Link>
              {" · "}
              <Link href={privacyUrl} style={{ color: EMAIL_COLORS.textMuted, textDecoration: "underline" }}>
                Privacy policy
              </Link>
              {" · "}
              <Link href={refundPolicyUrl} style={{ color: EMAIL_COLORS.textMuted, textDecoration: "underline" }}>
                Refund policy
              </Link>
              {" · "}
              <Link href={supportUrl} style={{ color: EMAIL_COLORS.textMuted, textDecoration: "underline" }}>
                Contact us
              </Link>
            </Text>
            <Text className="muted" style={{ margin: "0 0 2px 0", fontSize: 12, fontWeight: 600, color: EMAIL_COLORS.textMuted }}>
              {legalName}
            </Text>
            <Text className="subtle" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: EMAIL_COLORS.textSubtle }}>
              {abn ? `ABN ${abn} · ` : ""}
              {supportEmail || "hello@xpertmoto.com.au"}
            </Text>
            <Text className="subtle" style={{ margin: "16px 0 0 0", fontSize: 12, color: EMAIL_COLORS.textSubtle }}>
              © {currentYear} {legalName}. Ride safe.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
