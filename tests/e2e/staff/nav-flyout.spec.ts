import { test, expect } from "../_fixtures/test";
import { BACK_OFFICE_NAV, canAccess, visibleChildren } from "@/lib/nav";

/**
 * The sidebar nav chrome itself — the route sweep deep-links every
 * destination, bypassing the sidebar. This walks each staff-visible parent
 * with children: hover to open the flyout, click the second child (the
 * first duplicates the parent), assert the URL landed.
 */

test.use({ guardMode: "strict" });

/** Children the STAFF session actually sees — role-gated tabs are filtered out. */
const STAFF_CHILDREN = new Map(
  BACK_OFFICE_NAV.map((i) => [i.href, visibleChildren(i, "STAFF")]),
);

const PARENTS = BACK_OFFICE_NAV.filter(
  (i) =>
    i.section === "staff" &&
    canAccess(i, "STAFF") &&
    (STAFF_CHILDREN.get(i.href)?.length ?? 0) > 1,
);

test("sidebar flyouts deep-link to their tabs", async ({ page }) => {
  await page.goto("/staff/dashboard");
  await expect(page.locator("main").first()).toBeVisible();

  for (const parent of PARENTS) {
    const link = page.locator(`aside a[href="${parent.href}"]`).first();
    await expect(link, `sidebar link for ${parent.label}`).toBeVisible();
    await link.hover();
    const child = STAFF_CHILDREN.get(parent.href)![1]!;
    const childLink = page.locator(`a[href="${child.href}"]`).first();
    await expect(childLink, `flyout child "${child.label}" of ${parent.label}`).toBeVisible({
      timeout: 5_000,
    });
    await childLink.click();
    await expect(page).toHaveURL(
      new RegExp(child.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  }
});
