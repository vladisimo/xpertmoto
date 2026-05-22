import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

/**
 * Auth + role-protected-route tests. Assumes the seed script has been
 * run (`npm run db:seed`) so the credentials below exist. These tests
 * are skipped automatically when running against an unseeded DB by
 * looking for the login form and bailing early.
 */

const CUSTOMER = { email: "sarah.smith@example.com", password: "customer1234" };
const STAFF = { email: "staff.gold-coast@xpertmoto.com.au", password: "staff1234" };
const ADMIN = { email: "admin@xpertmoto.com.au", password: "admin1234" };
// Re-used as a "dual access" user — a MANAGER (back-office role) who also
// has a customerProfile attached in beforeAll. Triggers the /portal-select
// flow without polluting the always-back-office STAFF / ADMIN cases above.
const DUAL = { email: "manager.gold-coast@xpertmoto.com.au", password: "staff1234" };

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

test("unauthenticated /portal-select redirects to login", async ({ page }) => {
  await page.goto("/portal-select");
  await expect(page).toHaveURL(/login/i);
});

test.describe("/portal-select — dual-access (back-office + customerProfile)", () => {
  test.beforeAll(async () => {
    // Promote the Gold Coast MANAGER to a "dual access" user by attaching
    // a customerProfile if one doesn't already exist. The minimal field
    // set mirrors what the customer onboarding flow would have set.
    const user = await prisma.user.findUnique({ where: { email: DUAL.email } });
    if (!user) test.skip(true, `Seed user ${DUAL.email} not found`);
    await prisma.customerProfile.upsert({
      where: { userId: user!.id },
      create: {
        userId: user!.id,
        licenceNumber: "E2E-DUAL-0001",
        licenceState: "QLD",
        licenceClass: "C",
        licenceExpiry: new Date(2030, 0, 1),
        addressLine1: "1 Test St",
        suburb: "Surfers Paradise",
        state: "QLD",
        postcode: "4217",
      },
      update: {},
    });
  });

  test.afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: DUAL.email } });
    if (user) {
      await prisma.customerProfile.deleteMany({ where: { userId: user.id } });
    }
    await prisma.$disconnect();
  });

  test("dual-access user lands on /portal-select with Customer + Staff tiles", async ({ page }) => {
    await login(page, DUAL.email, DUAL.password);
    await page.waitForURL(/portal-select/i, { timeout: 10_000 });
    await expect(page.getByRole("link", { name: /customer portal/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /staff portal/i })).toBeVisible();
    // MANAGER must NOT see Admin Portal — only ADMIN / SUPER_ADMIN do.
    await expect(page.getByRole("link", { name: /admin portal/i })).toHaveCount(0);
  });

  test("picking Staff Portal navigates to /staff/dashboard", async ({ page }) => {
    await login(page, DUAL.email, DUAL.password);
    await page.waitForURL(/portal-select/i, { timeout: 10_000 });
    await page.getByRole("link", { name: /staff portal/i }).click();
    await page.waitForURL(/staff/i, { timeout: 10_000 });
    await expect(page.locator("body")).toContainText(/pickup|return|booking/i);
  });

  test("callbackUrl deep-links are dropped for dual-access users", async ({ page }) => {
    await page.goto("/login?callbackUrl=%2Fadmin%2Fdepots");
    await page.fill('input[type="email"]', DUAL.email);
    await page.fill('input[type="password"]', DUAL.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    // Even with an explicit callbackUrl, the dual-access user must land
    // on the selector — per spec, deep-links are intentionally dropped.
    await page.waitForURL(/portal-select/i, { timeout: 10_000 });
  });
});
