import { test as setup, expect } from "@playwright/test";
import { STORAGE_STATE } from "../../playwright.config";
import { login } from "./_fixtures/login";

const CUSTOMER = { email: "sarah.smith@example.com", password: "customer1234" };
const STAFF = { email: "staff.lewisham@xpertmoto.com.au", password: "staff1234" };
const ADMIN = { email: "admin@xpertmoto.com.au", password: "admin1234" };

setup("authenticate as customer", async ({ page }) => {
  await login(page, CUSTOMER.email, CUSTOMER.password, { expectedUrl: /dashboard/i });
  await expect(page.locator("body")).toContainText(/dashboard|booking/i);
  await page.context().storageState({ path: STORAGE_STATE.customer });
});

setup("authenticate as staff", async ({ page }) => {
  // Back-office login clears the forced-2FA gate via the seeded e2e TOTP secret.
  await login(page, STAFF.email, STAFF.password, { expectedUrl: /staff|portal-select/i });
  if (/portal-select/.test(page.url())) {
    await page.goto("/staff/dashboard");
    await page.waitForURL(/staff/i, { timeout: 20_000 });
  }
  await expect(page.locator("body")).toContainText(/pickup|return|booking|dashboard|tasks/i);
  await page.context().storageState({ path: STORAGE_STATE.staff });
});

setup("authenticate as admin", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password, { expectedUrl: /admin|portal-select/i });
  // SUPER_ADMIN also carries a customer profile, so it may land on /portal-select.
  if (/portal-select/.test(page.url())) {
    await page.goto("/admin/dashboard");
    await page.waitForURL(/admin/i, { timeout: 20_000 });
  }
  await expect(page.locator("body")).toContainText(/dashboard|revenue|reports|settings/i);
  await page.context().storageState({ path: STORAGE_STATE.admin });
});
