import { test, expect } from "@playwright/test";

/**
 * Admin can edit the trading name from /admin/settings and the change
 * propagates through the back-office sidebar alt text. The branding panel
 * also exposes logo/square/favicon upload slots. Requires the seed script
 * to have been run so the admin credentials below exist.
 */

const ADMIN = { email: "admin@xpertmoto.com.au", password: "admin1234" };

test("admin settings surfaces branding panel + propagates trading name", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/admin/i, { timeout: 15_000 }).catch(() => undefined);

  await page.goto("/admin/settings");
  await expect(page.getByRole("button", { name: /organisation/i })).toBeVisible();

  // Brand-asset upload slots exist.
  await expect(page.getByText(/horizontal logo/i)).toBeVisible();
  await expect(page.getByText(/square logo/i)).toBeVisible();
  await expect(page.getByText(/^favicon$/i)).toBeVisible();

  // Trading-name round-trip: set → observe in sidebar alt text → reset.
  const tradingInput = page.locator('input[id="org.tradingName"]');
  const original = (await tradingInput.inputValue()) || "XPERT Moto";
  const custom = `TestBrand-${Date.now()}`;

  await tradingInput.fill(custom);
  await tradingInput.blur();
  await expect(page.locator('body')).toContainText(/saved/i, { timeout: 5_000 });

  await page.goto("/staff/dashboard");
  // Sidebar logo uses the trading name as alt text.
  await expect(page.locator(`img[alt="${custom}"]`).first()).toBeVisible({
    timeout: 10_000,
  });

  // Revert so other specs see the baseline name.
  await page.goto("/admin/settings");
  await page.locator('input[id="org.tradingName"]').fill(original);
  await page.locator('input[id="org.tradingName"]').blur();
});
