import { test, expect } from "./_fixtures/test";
import { login } from "./_fixtures/login";
import { totpNow } from "./_fixtures/totp";
import { e2ePrisma as prisma } from "./_fixtures/db";

/**
 * Auth + role-protected-route tests. Assumes the seed script has been
 * run (`npm run db:seed`) so the credentials below exist. These tests
 * are skipped automatically when running against an unseeded DB by
 * looking for the login form and bailing early.
 */

const CUSTOMER = { email: "sarah.smith@example.com", password: "customer1234" };
const STAFF = { email: "staff.lewisham@xpertmoto.com.au", password: "staff1234" };
const ADMIN = { email: "admin@xpertmoto.com.au", password: "admin1234" };
// Re-used as a "dual access" user — a MANAGER (back-office role) who also
// has a customerProfile attached in beforeAll. Triggers the /portal-select
// flow without polluting the always-back-office STAFF / ADMIN cases above.
const DUAL = { email: "manager.lewisham@xpertmoto.com.au", password: "staff1234" };

test("customer login reaches dashboard", async ({ page }) => {
  await login(page, CUSTOMER.email, CUSTOMER.password);
  await page.waitForURL(/dashboard/i, { timeout: 10_000 }).catch(() => undefined);
  await expect(page.locator("body")).toContainText(/dashboard|booking/i);
});

test("staff login reaches staff area", async ({ page }) => {
  await login(page, STAFF.email, STAFF.password, { expectedUrl: /staff|portal-select/i });
  // Back-office users with a customerProfile land on the portal selector.
  if (/portal-select/.test(page.url())) {
    await page.getByRole("link", { name: /staff portal/i }).click();
  }
  await page.waitForURL(/staff/i, { timeout: 15_000 });
  await expect(page.locator("body")).toContainText(/pickup|return|booking/i);
});

test("admin login reaches admin area", async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password, { expectedUrl: /admin|portal-select/i });
  if (/portal-select/.test(page.url())) {
    await page.getByRole("link", { name: /admin portal/i }).click();
  }
  await page.waitForURL(/admin/i, { timeout: 15_000 });
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
    await page.waitForURL(/portal-select/i, { timeout: 30_000 });
    await expect(page.getByRole("link", { name: /customer portal/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /staff portal/i })).toBeVisible();
    // MANAGER must NOT see Admin Portal — only ADMIN / SUPER_ADMIN do.
    await expect(page.getByRole("link", { name: /admin portal/i })).toHaveCount(0);
  });

  test("picking Staff Portal navigates to /staff/dashboard", async ({ page }) => {
    // Login + two compile-heavy navigations on a cold CI dev server can
    // brush the default 60s test timeout.
    test.slow();
    await login(page, DUAL.email, DUAL.password, { expectedUrl: /portal-select|staff/i });
    // /portal-select self-forwards when it decides only one portal is
    // usable (e.g. the customer profile still requires onboarding) — accept
    // either the selector (click through) or a direct staff landing. The
    // forward can also race this very click (tile vanishes mid-click), so
    // swallow the click failure and let waitForURL be the real assertion.
    if (/portal-select/i.test(page.url())) {
      await page
        .getByRole("link", { name: /staff portal/i })
        .click({ timeout: 30_000 })
        .catch(() => undefined);
    }
    // Generous: first compile of /staff/dashboard on a cold dev server.
    await page.waitForURL(/staff/i, { timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/pickup|return|booking/i);
  });

  test("callbackUrl deep-links are dropped for dual-access users", async ({ page }) => {
    await page.goto("/login?callbackUrl=%2Fadmin%2Fdepots");
    await page.fill('input[type="email"]', DUAL.email);
    await page.fill('input[type="password"]', DUAL.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    // Back-office user → TOTP step before sign-in completes.
    const totpInput = page.locator("#totpCode");
    await totpInput.waitFor({ state: "visible", timeout: 15_000 });
    await totpInput.fill(totpNow());
    await totpInput.press("Enter");
    // Even with an explicit callbackUrl, the dual-access user must land
    // on the selector — per spec, deep-links are intentionally dropped.
    await page.waitForURL(/portal-select/i, { timeout: 10_000 });
  });
});
