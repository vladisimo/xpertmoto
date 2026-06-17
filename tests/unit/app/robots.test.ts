import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MetadataRoute } from "next";

const h = vi.hoisted(() => ({
  env: { NODE_ENV: "production" as string, SEO_INDEXABLE: undefined as string | undefined },
  getSiteUrl: vi.fn(() => "https://example.com"),
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/seo/site-url", () => ({ getSiteUrl: h.getSiteUrl }));

import robots from "@/app/robots";

function firstRule(r: MetadataRoute.Robots) {
  const rules = r.rules;
  const rule = Array.isArray(rules) ? rules[0] : rules;
  if (!rule) throw new Error("no rule");
  return rule;
}

beforeEach(() => {
  h.env.NODE_ENV = "production";
  h.env.SEO_INDEXABLE = undefined;
});

describe("robots", () => {
  it("allows crawling in production and references the sitemap + host", () => {
    const r = robots();
    expect(r.sitemap).toBe("https://example.com/sitemap.xml");
    expect(r.host).toBe("https://example.com");
    const rule = firstRule(r);
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toContain("/api/");
    expect(rule.disallow).toContain("/admin/");
    expect(rule.disallow).toContain("/booking/confirmation");
  });

  it("blocks everything and omits the sitemap on non-production hosts", () => {
    h.env.NODE_ENV = "development";
    const r = robots();
    expect(r.sitemap).toBeUndefined();
    expect(firstRule(r).disallow).toBe("/");
  });

  it("force-allows when SEO_INDEXABLE=1 even in development", () => {
    h.env.NODE_ENV = "development";
    h.env.SEO_INDEXABLE = "1";
    expect(firstRule(robots()).allow).toBe("/");
  });

  it("force-blocks when SEO_INDEXABLE=0 even in production", () => {
    h.env.SEO_INDEXABLE = "0";
    const r = robots();
    expect(r.sitemap).toBeUndefined();
    expect(firstRule(r).disallow).toBe("/");
  });
});
