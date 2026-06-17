import { render } from "@react-email/render";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// EmailLayout reads branding at render time; stub it so the test doesn't touch
// the DB. Values mirror the email-ops/email-shell tests so the two rendering
// paths can be compared landmark-for-landmark.
const getEmailBrandingVars = vi.fn();
vi.mock("@/lib/email-branding-vars", () => ({
  getEmailBrandingVars: (...a: unknown[]) => getEmailBrandingVars(...a),
}));

const BRAND_VARS = {
  siteName: "XPERT Moto",
  legalName: "XPERT Moto Group Pty Ltd",
  abn: "72 629 456 408",
  supportEmail: "hello@xpertmoto.com.au",
  privacyEmail: "privacy@xpertmoto.com.au",
  postalAddress: "1 Test St",
  logoUrl: "https://cdn.example.com/logo.png",
  appUrl: "https://example.com",
  termsUrl: "https://example.com/terms",
  privacyUrl: "https://example.com/privacy",
  refundPolicyUrl: "https://example.com/refund-policy",
  supportUrl: "https://example.com/contact",
  unsubscribeUrl: "https://example.com/dashboard/preferences",
  currentYear: "2026",
};

beforeEach(() => {
  getEmailBrandingVars.mockReset();
  getEmailBrandingVars.mockResolvedValue(BRAND_VARS);
});

describe("EmailLayout — React templates share the unified shell look", () => {
  it("renders the branded card, linked logo, policy footer and dark/mobile styles", async () => {
    const BondReleased = (await import("../../emails/bond-released")).default;
    const html = await render(
      createElement(BondReleased, {
        customerName: "Alex",
        bookingReference: "SCT-1234",
        amount: "A$200.00",
      }),
    );

    // Card surface (matches the string shell's 12px radius card).
    expect(html).toContain("border-radius:12px");
    // Linked, absolute logo.
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('href="https://example.com"');
    // Policy-link footer + legal identity + sign-off — same as the shell.
    expect(html).toContain("Terms of service");
    expect(html).toContain('href="https://example.com/refund-policy"');
    expect(html).toContain("XPERT Moto Group Pty Ltd");
    expect(html).toContain("ABN 72 629 456 408");
    expect(html).toContain("Ride safe");
    // Mobile + dark-mode media queries carried in <head>.
    expect(html).toContain("@media only screen and (max-width: 600px)");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    // The template's own content still renders inside the shell.
    expect(html).toContain("Your bond has been released");
  });
});
