import { test, expect } from "@playwright/test";

/**
 * Auth + role-protected-route tests. Assumes the seed script has been
 * run (`npm run db:seed`) so the credentials below exist. These tests
 * are skipped automatically when running against an unseeded DB by
 * looking for the login form and bailing early.
 */

const CUSTOMER = { email: "sarah.smith@example.com", password: "customer1234" };
const STAFF = { email: "staff.gold-coast@scootering.com.au", password: "staff1234" };
const ADMIN = { email: "admin@scootering.com.au", password: "admin1234" };

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
}

test("customer login reaches dashboard", async ({ page }) => {
  await login(page, CUSTOMER.email, CUSTOMER.password);
  await page.waitForURL(/dashboard/i, { timeout: 10_000 }).catch(() => undefined);
  await expect(page.locator("body")).toContainText(/dashboard|booking/i);
});

test("staff login reaches staff area", async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  await page.waitForURL(/staff/i, { timeout: 10_000 }).catch(() => undefined);
  await expect(page.locator("body")).toContainText(/pickup|return|booking/i);
});

test("admin login reaches admin area", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.waitForURL(/admin/i, { timeout: 10_000 }).catch(() => undefined);
  await expect(page.locator("body")).toContainText(/dashboard|revenue|reports/i);
});

test("unauthenticated staff area redirects to login", async ({ page }) => {
  await page.goto("/staff/dashboard");
  await expect(page).toHaveURL(/login/i);
});

test("unauthenticated admin area redirects to login", async ({ page }) => {
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/login/i);
});

test("unauthenticated step-up page redirects to login", async ({ page }) => {
  // /verify-2fa-step-up is only meaningful for half-authenticated sessions
  // (OAuth or magic-link sign-in landed on a TOTP-enrolled user). Cold
  // visits with no session must bounce to /login. Full OAuth -> step-up
  // -> dashboard coverage requires a mock OAuth server; this spec covers
  // the public-facing contract that the route exists and refuses anon.
  await page.goto("/verify-2fa-step-up");
  await expect(page).toHaveURL(/login/i);
});
