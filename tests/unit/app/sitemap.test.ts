import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  getSiteUrl: vi.fn(() => "https://example.com"),
  connection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/server", () => ({ connection: h.connection }));
vi.mock("@/lib/prisma", () => ({ prisma: { vehicleModel: { findMany: h.findMany } } }));
vi.mock("@/lib/seo/site-url", () => ({ getSiteUrl: h.getSiteUrl }));
vi.mock("@/content/tours", () => ({
  TOURS: [{ slug: "blue-mountains" }, { slug: "coast-run" }],
}));

import sitemap from "@/app/sitemap";

beforeEach(() => {
  h.connection.mockClear();
  h.findMany
    .mockReset()
    .mockResolvedValue([{ slug: "honda-x", updatedAt: new Date("2026-01-01") }]);
});

describe("sitemap", () => {
  it("includes static public routes as absolute URLs", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://example.com/");
    expect(urls).toContain("https://example.com/fleet");
    expect(urls).toContain("https://example.com/pricing");
    expect(urls).toContain("https://example.com/privacy");
  });

  it("excludes auth/admin/api/booking-confirmation routes", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
    expect(urls.some((u) => u.includes("/api"))).toBe(false);
    expect(urls.some((u) => u.includes("/booking/confirmation"))).toBe(false);
    expect(urls.some((u) => u.includes("/login"))).toBe(false);
  });

  it("includes rentable fleet slugs with updatedAt as lastModified", async () => {
    const fleet = (await sitemap()).find(
      (e) => e.url === "https://example.com/fleet/honda-x",
    );
    expect(fleet).toBeDefined();
    expect(fleet?.lastModified).toEqual(new Date("2026-01-01"));
  });

  it("queries with the shared rentable-model filter", async () => {
    await sitemap();
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isRentable: true, vehicles: { some: { isActive: true } } },
      }),
    );
  });

  it("includes tour slugs from the content module", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://example.com/tours/blue-mountains");
    expect(urls).toContain("https://example.com/tours/coast-run");
  });

  it("opts into dynamic rendering via connection()", async () => {
    await sitemap();
    expect(h.connection).toHaveBeenCalled();
  });

  it("keeps every priority within [0, 1]", async () => {
    for (const e of await sitemap()) {
      expect(typeof e.priority).toBe("number");
      const p = e.priority as number;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
