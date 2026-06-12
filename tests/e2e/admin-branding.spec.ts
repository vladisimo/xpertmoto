import { test, expect } from "./_fixtures/test";
import { login } from "./_fixtures/login";

/**
 * Admin can edit the trading name from /admin/settings and the change
 * propagates through the back-office sidebar alt text. The branding panel
 * also exposes logo/square/favicon upload slots. Requires the seed script
 * to have been run so the admin credentials below exist.
 */

const ADMIN = { email: "admin@xpertmoto.com.au", password: "admin1234" };

test("admin settings surfaces branding panel + propagates trading name", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password, { expectedUrl: /admin|portal-select/i });

  await page.goto("/admin/settings");
  // Settings tabs are role=tab (URL-driven tab bar), not buttons.
  await expect(page.getByRole("tab", { name: /organisation/i })).toBeVisible();

  // Brand-asset upload slots exist.
  await expect(page.getByText(/horizontal logo/i).first()).toBeVisible();
  await expect(page.getByText(/square logo/i).first()).toBeVisible();
  await expect(page.getByText(/^favicon$/i).first()).toBeVisible();

  // Trading-name round-trip: set → observe in sidebar alt text → reset.
  const tradingInput = page.locator('input[id="org.tradingName"]');
  const original = (await tradingInput.inputValue()) || "XPERT Moto";
  // Keep "XPERT Moto" as the prefix: the trading name is GLOBAL state and
  // parallel public specs assert /XPERT Moto/ in titles mid-rename.
  const custom = `XPERT Moto ${Date.now().toString(36).toUpperCase()}`;

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
