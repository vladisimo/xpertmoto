import { beforeEach, describe, expect, it, vi } from "vitest";

const getBrandingMock = vi.fn();
vi.mock("@/lib/branding", () => ({
  getBranding: () => getBrandingMock(),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/well-known/security-txt/route";

const BASE_BRANDING = {
  siteName: "XPERT Moto",
  tagline: "",
  legalName: "XPERT Moto Group Pty Ltd",
  abn: "72 629 456 408",
  brandColor: "#1B6B4A",
  supportEmail: null as string | null,
  supportPhone: null,
  privacyEmail: null as string | null,
  postalAddress: null,
  logoWideUrl: null,
  logoBlackUrl: null,
  logoSquareUrl: null,
  faviconUrl: null,
  social: { facebook: null, instagram: null, tiktok: null, youtube: null },
};

const req = () =>
  new NextRequest("https://xpertmoto.dfortix.ai/.well-known/security.txt");

describe("GET /.well-known/security.txt", () => {
  beforeEach(() => getBrandingMock.mockReset());

  it("serves text/plain with the privacy contact and RFC 9116 fields", async () => {
    getBrandingMock.mockResolvedValue({ ...BASE_BRANDING, privacyEmail: "privacy@example.com" });

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");

    const text = await res.text();
    expect(text).toContain("Contact: mailto:privacy@example.com");
    expect(text).toMatch(/^Expires: .+Z$/m);
    expect(text).toContain("Canonical: https://xpertmoto.dfortix.ai/.well-known/security.txt");
    expect(text).toContain("Policy: https://xpertmoto.dfortix.ai/privacy");
  });

  it("falls back to the support email when no privacy email is set", async () => {
    getBrandingMock.mockResolvedValue({ ...BASE_BRANDING, supportEmail: "help@example.com" });

    const text = await (await GET(req())).text();
    expect(text).toContain("Contact: mailto:help@example.com");
  });

  it("falls back to security@<host> when no branding email is configured", async () => {
    getBrandingMock.mockResolvedValue({ ...BASE_BRANDING });

    const text = await (await GET(req())).text();
    expect(text).toContain("Contact: mailto:security@xpertmoto.dfortix.ai");
  });
});
