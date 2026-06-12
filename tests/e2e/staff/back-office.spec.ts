import { test, expect } from "../_fixtures/test";

/**
 * Staff back-office access (runs with the seeded staff.lewisham session from
 * auth.setup → STORAGE_STATE.staff). The headline assertion is implicit: the
 * session already cleared the forced-TOTP gate on /staff during setup (via the
 * deterministic seeded secret), so these pages render at all.
 */

test("staff dashboard renders the back-office shell", async ({ page }) => {
  await page.goto("/staff/dashboard");
  await expect(page).toHaveURL(/\/staff/);
  await expect(page).not.toHaveURL(/\/login|\/totp\/enroll/);
  await expect(page.locator("body")).toContainText(/dashboard|pickup|return|today|fleet|booking/i);
});

test("staff task queue is reachable", async ({ page }) => {
  await page.goto("/staff/tasks");
  await expect(page).not.toHaveURL(/\/login|\/totp\/enroll/);
  await expect(page.locator("body")).toContainText(/task|queue|pickup|return|nothing|all clear/i);
});
