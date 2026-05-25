import { test, expect } from "@playwright/test";

/**
 * Admin access (runs with the seeded admin@xpertmoto.com.au SUPER_ADMIN
 * session from auth.setup → STORAGE_STATE.admin). Confirms the admin portal
 * renders past the role + forced-TOTP gates and exposes configuration.
 */

test("admin dashboard renders", async ({ page }) => {
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/admin/);
  await expect(page).not.toHaveURL(/\/login|\/totp\/enroll/);
  await expect(page.locator("body")).toContainText(/dashboard|revenue|reports|overview|settings/i);
});

test("admin settings is reachable", async ({ page }) => {
  await page.goto("/admin/settings");
  await expect(page).not.toHaveURL(/\/login|\/totp\/enroll/);
  await expect(page.locator("body")).toContainText(/setting|branding|configuration|general|pricing/i);
});
