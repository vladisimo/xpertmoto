import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("renderOpsNoticeEmail", () => {
  it("wraps the plain text in a <pre> inside the branded shell", async () => {
    const { renderOpsNoticeEmail } = await import("@/lib/email-ops");
    const html = await renderOpsNoticeEmail({
      subject: "Weekly analytics digest",
      text: "Sessions: 1,024\nConverted: 4.2%\nTop path: /book",
    });

    // Shell landmarks present.
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(">Weekly analytics digest</h1>");
    expect(html).toContain("<pre");
    expect(html).toContain("Sessions: 1,024");
    expect(html).toContain("Converted: 4.2%");
  });

  it("resolves every branding placeholder (no literal {{...}} left)", async () => {
    const { renderOpsNoticeEmail } = await import("@/lib/email-ops");
    const html = await renderOpsNoticeEmail({ subject: "Alert", text: "x" });

    expect(html).not.toContain("{{");
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('href="https://example.com/terms"');
    expect(html).toContain("XPERT Moto Group Pty Ltd");
    expect(html).toContain("ABN 72 629 456 408");
    expect(html).toContain("&copy; 2026");
  });

  it("HTML-escapes the body so markup characters can't break the layout", async () => {
    const { renderOpsNoticeEmail } = await import("@/lib/email-ops");
    const html = await renderOpsNoticeEmail({
      subject: "Alert",
      text: "threshold <= 5 & rising",
    });

    expect(html).toContain("threshold &lt;= 5 &amp; rising");
    expect(html).not.toContain("threshold <= 5 & rising");
  });
});
