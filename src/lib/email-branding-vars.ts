import { getBranding } from "@/lib/branding";

/**
 * Canonical list of variables every email template can reference, regardless
 * of trigger context. These come from branding + env config, not the sender's
 * per-recipient payload. `renderTemplate` sees them merged in on top of
 * caller-supplied variables, so callers may override (e.g. a test-send that
 * forces a different `supportEmail`).
 */
export type EmailBrandingVars = {
  siteName: string;
  legalName: string;
  abn: string;
  supportEmail: string;
  privacyEmail: string;
  postalAddress: string;
  logoUrl: string;
  appUrl: string;
  termsUrl: string;
  privacyUrl: string;
  refundPolicyUrl: string;
  supportUrl: string;
  unsubscribeUrl: string;
  currentYear: string;
};

function absoluteUrl(url: string | null, base: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

function appBaseUrl(): string {
  return (
    process.env.AUTH_URL ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  );
}

/**
 * Reads branding config and returns a `Record<string, string>` ready to
 * merge into `renderTemplate` variables. Missing fields resolve to empty
 * strings — template authors see `{{legalName}}` as blank rather than the
 * literal placeholder, which is the friendlier failure mode.
 */
export async function getEmailBrandingVars(): Promise<Record<string, string>> {
  const b = await getBranding();
  const appUrl = appBaseUrl().replace(/\/$/, "");
  const logoUrl =
    absoluteUrl(b.logoWideUrl, appUrl) ??
    absoluteUrl("/brand/xpert-logo-white.png", appUrl) ??
    "";
  return {
    siteName: b.siteName,
    legalName: b.legalName ?? "",
    abn: b.abn ?? "",
    supportEmail: b.supportEmail ?? "",
    privacyEmail: b.privacyEmail ?? b.supportEmail ?? "",
    postalAddress: b.postalAddress ?? "",
    logoUrl,
    appUrl,
    termsUrl: `${appUrl}/terms`,
    privacyUrl: `${appUrl}/privacy`,
    refundPolicyUrl: `${appUrl}/refund-policy`,
    supportUrl: `${appUrl}/contact`,
    // Per-recipient unsubscribe tokens are out of scope — this is the
    // generic customer preferences page; marketing senders can override
    // with a tokenised URL via their caller-supplied variables.
    unsubscribeUrl: `${appUrl}/dashboard/preferences`,
    currentYear: String(new Date().getUTCFullYear()),
  };
}
