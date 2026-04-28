import { test as setup, expect } from "@playwright/test";
import { STORAGE_STATE } from "../../playwright.config";

const CUSTOMER = { email: "sarah.smith@example.com", password: "customer1234" };
const STAFF = { email: "staff.gold-coast@scootering.com.au", password: "staff1234" };
const ADMIN = { email: "admin@scootering.com.au", password: "admin1234" };

async function login(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
  expectedUrl: RegExp,
) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(expectedUrl, { timeout: 15_000 });
}

setup("authenticate as customer", async ({ page }) => {
  await login(page, CUSTOMER.email, CUSTOMER.password, /dashboard/i);
  await expect(page.locator("body")).toContainText(/dashboard|booking/i);
  await page.context().storageState({ path: STORAGE_STATE.customer });
});

setup("authenticate as staff", async ({ page }) => {
  await login(page, STAFF.email, STAFF.password, /staff/i);
  await expect(page.locator("body")).toContainText(/pickup|return|booking/i);
  await page.context().storageState({ path: STORAGE_STATE.staff });
});

setup("authenticate as admin", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password, /admin/i);
  await expect(page.locator("body")).toContainText(/dashboard|revenue|reports/i);
  await page.context().storageState({ path: STORAGE_STATE.admin });
});
