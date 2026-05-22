import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { EMAIL_COLORS } from "./tokens";
import { getBranding } from "@/lib/branding";

/**
 * Email clients fetch resources by absolute URL only. In local dev the
 * storage helper returns a same-origin path like `/uploads/branding/x.png`,
 * which a real inbox can't resolve. Prefix with the public app URL so the
 * `<Img>` src is always reachable from outside our origin.
 */
function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    process.env.AUTH_URL ??
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function EmailLayout({
  preview,
  heading,
  children,
}: {
  preview: string;
  heading: string;
  children: ReactNode;
}) {
  const { siteName, legalName, abn, logoWideUrl, supportEmail } = await getBranding();
  const logoSrc = absoluteUrl(logoWideUrl);
  return (
    <Html lang="en-AU">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: EMAIL_COLORS.background, fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px" }}>
          <Section style={{ borderBottom: `3px solid ${EMAIL_COLORS.primary}`, paddingBottom: 12, marginBottom: 24 }}>
            {logoSrc ? (
              <Img
                src={logoSrc}
                alt={siteName}
                height={40}
                style={{ display: "block", height: 40, width: "auto", maxWidth: 240 }}
              />
            ) : (
              <Text style={{ fontSize: 24, fontWeight: 700, color: EMAIL_COLORS.primary, margin: 0 }}>
                🛵 {siteName}
              </Text>
            )}
          </Section>
          <Heading as="h1" style={{ fontSize: 22, color: EMAIL_COLORS.textPrimary, margin: "0 0 16px" }}>
            {heading}
          </Heading>
          {children}
          <Hr style={{ borderColor: EMAIL_COLORS.border, margin: "32px 0 16px" }} />
          <Text style={{ fontSize: 11, color: EMAIL_COLORS.textSubtle, lineHeight: 1.5 }}>
            {legalName}
            {abn ? ` · ABN ${abn}` : ""} · {supportEmail ?? "hello@xpertmoto.com.au"}
            <br />
            You are receiving this email because you have a booking or account with {siteName}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
