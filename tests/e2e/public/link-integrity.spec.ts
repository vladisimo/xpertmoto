import { test, expect } from "../_fixtures/test";
import { PUBLIC_ROUTES } from "../_manifest/routes";

/**
 * Dead-link sweep over the marketing surface: collect every same-origin
 * <a href> from each public page, dedupe, and HTTP-check each target
 * (no browser, plain requests). Catches footer rot and broken CTAs the
 * route sweep can't see (it only visits the manifest).
 */

test("no public page links to a broken same-origin URL", async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);
  const seen = new Set<string>();
  const sources = new Map<string, string>();

  for (const route of PUBLIC_ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((a) => a.getAttribute("href")!)
        .filter((h) => h.startsWith("/") && !h.startsWith("//")),
    );
    for (const href of hrefs) {
      const clean = href.split("#")[0]!;
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      sources.set(clean, route);
    }
  }

  expect(seen.size).toBeGreaterThan(10);

  const broken: string[] = [];
  for (const href of seen) {
    // Auth-gated targets redirect to /login — that's a working link.
    const res = await request.get(`${baseURL}${href}`, { maxRedirects: 5 });
    if (res.status() >= 400) {
      broken.push(`${href} → HTTP ${res.status()} (linked from ${sources.get(href)})`);
    }
  }
  expect(broken, `broken links:\n${broken.join("\n")}`).toEqual([]);
});
