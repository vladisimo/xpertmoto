import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  type HelpCategoryId,
} from "@/lib/help/manifest";
import { BACK_OFFICE_NAV } from "@/lib/nav";

const CONTENT_ROOT = path.join(process.cwd(), "content", "help");
const VALID_CATEGORIES = new Set<HelpCategoryId>(HELP_CATEGORIES.map((c) => c.id));

// Every relatedNav href must be a real back-office route. Nav hrefs (and their
// children) are the canonical set; routes not in the sidebar (maintenance,
// incidents, inspections…) are accepted as long as they're /staff or /admin
// prefixed app routes.
const NAV_HREFS = new Set<string>();
for (const item of BACK_OFFICE_NAV) {
  NAV_HREFS.add(item.href);
  for (const child of item.children ?? []) NAV_HREFS.add(child.href);
}

describe("help manifest", () => {
  it("has at least one article", () => {
    expect(HELP_ARTICLES.length).toBeGreaterThan(0);
  });

  it("has unique slugs", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("references markdown files that exist on disk", () => {
    for (const article of HELP_ARTICLES) {
      const full = path.join(CONTENT_ROOT, article.file);
      expect(existsSync(full), `missing content file for "${article.slug}": ${article.file}`).toBe(
        true,
      );
    }
  });

  it("assigns every article to a known category", () => {
    for (const article of HELP_ARTICLES) {
      expect(VALID_CATEGORIES.has(article.category), `bad category on ${article.slug}`).toBe(true);
    }
  });

  it("only links relatedNav to real back-office routes", () => {
    for (const article of HELP_ARTICLES) {
      for (const href of article.relatedNav) {
        const isNav = NAV_HREFS.has(href);
        const isBackOfficeRoute = href.startsWith("/staff/") || href.startsWith("/admin/");
        expect(
          isNav || isBackOfficeRoute,
          `relatedNav "${href}" on ${article.slug} is not a back-office route`,
        ).toBe(true);
      }
    }
  });

  it("has featured (getting-started) articles", () => {
    const featured = HELP_ARTICLES.filter((a) => a.featured);
    expect(featured.length).toBeGreaterThan(0);
    for (const a of featured) {
      expect(a.category).toBe("getting-started");
      expect(a.audience.length).toBeGreaterThan(0);
    }
  });

  it("has a Help nav entry in both portals", () => {
    expect(NAV_HREFS.has("/staff/help")).toBe(true);
    expect(NAV_HREFS.has("/admin/help")).toBe(true);
  });
});
