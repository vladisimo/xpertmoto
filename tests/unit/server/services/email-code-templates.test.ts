import { beforeEach, describe, expect, it, vi } from "vitest";

// EmailLayout reads branding via getEmailBrandingVars at render time; stub it so
// rendering previews doesn't touch the DB.
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

describe("email-code-templates registry", () => {
  it("lists templates with complete metadata, sorted by category then name", async () => {
    const { listCodeTemplates } = await import("@/server/services/email-code-templates");
    const list = listCodeTemplates();

    expect(list.length).toBeGreaterThanOrEqual(20);
    for (const t of list) {
      expect(t.key).toMatch(/^[a-z0-9-]+$/);
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.file).toMatch(/^emails\/.+\.tsx$/);
      expect(["TRANSACTIONAL", "ACCOUNT", "OPERATIONAL", "MARKETING"]).toContain(t.category);
      expect(t.channels.length).toBeGreaterThan(0);
    }

    // Keys are unique.
    const keys = list.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);

    // Sorted by (category, name).
    const sorted = [...list].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
    expect(list).toEqual(sorted);
  });

  it("renders EVERY template to branded HTML with its sample props (no missing/invalid props)", async () => {
    const { listCodeTemplates, renderCodeTemplatePreview } = await import(
      "@/server/services/email-code-templates"
    );

    for (const t of listCodeTemplates()) {
      const preview = await renderCodeTemplatePreview(t.key);
      expect(preview, `preview for ${t.key}`).not.toBeNull();
      const html = preview!.html;
      // Branded shell landmarks (unified layout) + non-trivial content.
      expect(html.toLowerCase(), t.key).toContain("<html");
      expect(html, t.key).toContain("Terms of service");
      expect(html.length, t.key).toBeGreaterThan(500);
      // Branding placeholders resolved through the layout.
      expect(html, t.key).toContain("XPERT Moto Group Pty Ltd");
    }
  });

  it("returns null for an unknown key", async () => {
    const { renderCodeTemplatePreview } = await import("@/server/services/email-code-templates");
    expect(await renderCodeTemplatePreview("does-not-exist")).toBeNull();
  });
});
