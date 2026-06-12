import { test, expect } from "../_fixtures/test";
import { crawlTabs } from "../_fixtures/interactions";

/**
 * Click-crawl of in-page tab bars on admin hub pages. The route sweep visits
 * each tab via `?tab=` deep links; this verifies the tab CONTROLS work too
 * (click → aria-selected → visible panel) under the strict guard.
 */

test.use({ guardMode: "strict" });

for (const route of ["/admin/dashboard", "/admin/reports", "/admin/finance"] as const) {
  test(`tab controls work on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("main").first()).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const tabCount = await page.getByRole("tab").count();
    test.skip(tabCount === 0, `${route} renders no role=tab controls`);
    await crawlTabs(page);
  });
}
