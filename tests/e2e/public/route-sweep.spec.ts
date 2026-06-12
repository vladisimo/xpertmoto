import { test, expect } from "../_fixtures/test";
import { DEFAULT_ALLOWLIST, filterIssues } from "../_fixtures/browser-guard";
import { PUBLIC_ROUTES, PUBLIC_DYNAMIC } from "../_manifest/routes";
import { assertRouteRenders, resolveOrSkip } from "../_manifest/sweep";

/**
 * Render sweep over every public route: HTTP < 400, content mounts, and —
 * via guardMode strict — zero non-allowlisted console errors, page errors,
 * failed same-origin requests, or same-origin HTTP >= 400 responses.
 */

test.use({ guardMode: "strict" });

for (const route of PUBLIC_ROUTES) {
  test(`renders ${route}`, async ({ page }) => {
    await assertRouteRenders(page, route);
  });
}

for (const dyn of PUBLIC_DYNAMIC) {
  test(`renders ${dyn.name}`, async ({ page }, testInfo) => {
    const route = await resolveOrSkip(dyn, testInfo);
    test.skip(!route, `no representative row for ${dyn.name}`);
    await assertRouteRenders(page, route!);
  });
}

test.describe("not-found page", () => {
  // The 404 response is the expected outcome here. Playwright's test.use()
  // can't override array-valued fixture options (it treats arrays as
  // [value, options] tuples), so run guard-off and filter explicitly.
  test.use({ guardMode: "off" });

  test("unknown route renders the not-found page (no crash)", async ({ page, browserIssues }) => {
    const res = await page.goto("/this-route-does-not-exist", { waitUntil: "domcontentloaded" });
    expect(res!.status()).toBe(404);
    await expect(page.locator("body")).toContainText(/not found|back home/i);
    const unexpected = filterIssues(browserIssues, [
      ...DEFAULT_ALLOWLIST,
      // No statuses filter: the console-error mirror of the 404 carries no
      // status field; the pattern alone uniquely identifies this route.
      { pattern: /this-route-does-not-exist/ },
    ]);
    expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
  });
});
