import { describe, it, expect } from "vitest";
import {
  searchArticles,
  getContextualHelpSlug,
  navLabelForHref,
} from "@/lib/help/manifest.search";

describe("searchArticles", () => {
  it("returns nothing for queries shorter than 2 chars", () => {
    expect(searchArticles("")).toEqual([]);
    expect(searchArticles("a")).toEqual([]);
  });

  it("matches on title", () => {
    const results = searchArticles("fleet");
    expect(results.some((a) => a.slug === "fleet")).toBe(true);
  });

  it("matches on keyword", () => {
    const results = searchArticles("checkout");
    expect(results.some((a) => a.slug === "check-out-workflow")).toBe(true);
  });

  it("is case-insensitive", () => {
    const lower = searchArticles("invoice").map((a) => a.slug);
    const upper = searchArticles("INVOICE").map((a) => a.slug);
    expect(upper).toEqual(lower);
    expect(lower.length).toBeGreaterThan(0);
  });

  it("ranks a title match above a summary-only match", () => {
    const results = searchArticles("fleet");
    expect(results[0]?.slug).toBe("fleet");
  });
});

describe("getContextualHelpSlug", () => {
  it("resolves a booking sub-route to the most specific article", () => {
    const slug = getContextualHelpSlug("/staff/bookings/abc123/check-out");
    // "/staff/bookings" is the matching relatedNav prefix.
    expect(slug).not.toBeNull();
  });

  it("resolves a top-level section route", () => {
    expect(getContextualHelpSlug("/staff/fleet")).toBe("fleet");
    expect(getContextualHelpSlug("/staff/customers")).toBe("customers");
  });

  it("prefers the longest matching prefix", () => {
    // /admin/pricing maps to the pricing article even though /admin/finance
    // is also a relatedNav on it.
    expect(getContextualHelpSlug("/admin/pricing")).toBe("pricing");
  });

  it("returns null for routes with no mapped article", () => {
    expect(getContextualHelpSlug("/dashboard/bookings")).toBeNull();
    expect(getContextualHelpSlug("/")).toBeNull();
  });
});

describe("navLabelForHref", () => {
  it("uses the nav label for a known route", () => {
    expect(navLabelForHref("/staff/fleet")).toBe("Fleet");
    expect(navLabelForHref("/staff/customers")).toBe("Customers");
  });

  it("humanises routes that are not in the sidebar", () => {
    expect(navLabelForHref("/staff/maintenance")).toBe("Maintenance");
    expect(navLabelForHref("/staff/infringements")).toBe("Infringements");
  });
});
