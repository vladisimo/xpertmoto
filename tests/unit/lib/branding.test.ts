import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

// Invalidate the React.cache() memoization between tests by forcing
// re-evaluation of the module each run.
beforeEach(() => {
  findMany.mockReset();
  vi.resetModules();
});

describe("getBranding", () => {
  it("returns setting values when every row is populated", async () => {
    findMany.mockResolvedValue([
      { key: "org.tradingName", value: "Moto Rentals" },
      { key: "org.siteTagline", value: "Ride the coast" },
      { key: "org.legalName", value: "Moto Rentals Pty Ltd" },
      { key: "org.abn", value: "11 222 333 444" },
      { key: "org.logoWideUrl", value: "https://cdn.test/wide.png" },
      { key: "org.logoSquareUrl", value: "https://cdn.test/square.png" },
      { key: "org.faviconUrl", value: "https://cdn.test/fav.ico" },
    ]);
    const { getBranding } = await import("@/lib/branding");
    const b = await getBranding();
    expect(b).toMatchObject({
      siteName: "Moto Rentals",
      tagline: "Ride the coast",
      legalName: "Moto Rentals Pty Ltd",
      abn: "11 222 333 444",
      logoWideUrl: "https://cdn.test/wide.png",
      logoSquareUrl: "https://cdn.test/square.png",
      faviconUrl: "https://cdn.test/fav.ico",
    });
    // brandColor is sourced from `org.brandColor` and falls back to the
    // bundled brand green when no row is set.
    expect(b.brandColor).toBe("#1B6B4A");
  });

  it("falls back to defaults when no rows exist", async () => {
    findMany.mockResolvedValue([]);
    const { getBranding } = await import("@/lib/branding");
    const { SETTING_DEFAULTS } = await import("@/lib/settings-defaults");
    const b = await getBranding();
    expect(b.siteName).toBe(SETTING_DEFAULTS["org.tradingName"]);
    expect(b.tagline).toBe(SETTING_DEFAULTS["org.siteTagline"]);
    expect(b.legalName).toBe(SETTING_DEFAULTS["org.legalName"]);
    expect(b.abn).toBe(SETTING_DEFAULTS["org.abn"]);
    expect(b.logoWideUrl).toBeNull();
    expect(b.logoSquareUrl).toBeNull();
    expect(b.faviconUrl).toBeNull();
  });

  it("treats blank strings as unset and promotes square logo to favicon", async () => {
    findMany.mockResolvedValue([
      { key: "org.logoWideUrl", value: "   " },
      { key: "org.logoSquareUrl", value: "https://cdn.test/square.png" },
      { key: "org.faviconUrl", value: "" },
    ]);
    const { getBranding } = await import("@/lib/branding");
    const b = await getBranding();
    expect(b.logoWideUrl).toBeNull();
    expect(b.logoSquareUrl).toBe("https://cdn.test/square.png");
    // Favicon empty — falls through to square.
    expect(b.faviconUrl).toBe("https://cdn.test/square.png");
  });

  it("prefers an explicit favicon over the square logo when both are set", async () => {
    findMany.mockResolvedValue([
      { key: "org.logoSquareUrl", value: "https://cdn.test/square.png" },
      { key: "org.faviconUrl", value: "https://cdn.test/fav.ico" },
    ]);
    const { getBranding } = await import("@/lib/branding");
    const b = await getBranding();
    expect(b.faviconUrl).toBe("https://cdn.test/fav.ico");
  });

  it("recovers gracefully when Prisma throws", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    const { getBranding } = await import("@/lib/branding");
    const { SETTING_DEFAULTS } = await import("@/lib/settings-defaults");
    const b = await getBranding();
    expect(b.siteName).toBe(SETTING_DEFAULTS["org.tradingName"]);
    expect(b.logoWideUrl).toBeNull();
  });
});
