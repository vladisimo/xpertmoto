import { test, expect } from "./_fixtures/test";
import { login as sharedLogin } from "./_fixtures/login";
import { e2ePrisma as prisma } from "./_fixtures/db";

/**
 * /staff/tasks smoke. Depends on seeded credentials and at least one
 * actionable booking for today at the staff member's depot. Before each
 * test we release stale IN_PROGRESS task activities held by THIS spec's
 * staff user so earlier runs don't hold the partial-unique lock. (Scoped to
 * the user — a global release would race other staff specs mid-claim.)
 */

const STAFF = { email: "staff.lewisham@xpertmoto.com.au", password: "staff1234" };

test.beforeEach(async () => {
  await prisma.staffTaskActivity.updateMany({
    where: { status: "IN_PROGRESS", staff: { email: STAFF.email } },
    data: {
      status: "ABANDONED",
      completedAt: new Date(),
      outcome: "e2e_reset",
      outcomeNote: "Released by staff-tasks.spec.ts beforeEach",
    },
  });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("staff can open Priority Tasks page and see the queue chrome", async ({ page }) => {
  await sharedLogin(page, STAFF.email, STAFF.password);
  await page.goto("/staff/tasks");

  await expect(page.getByRole("heading", { name: /priority tasks/i })).toBeVisible();

  // KPI labels always render regardless of row count.
  await expect(page.getByText(/open tasks/i).first()).toBeVisible();
  await expect(page.getByText(/in progress/i).first()).toBeVisible();
  await expect(page.getByText(/urgent/i).first()).toBeVisible();

  // Filter bar + pagination primitives render.
  await expect(page.getByText(/priority/i).first()).toBeVisible();
  await expect(page.getByText(/rows per page/i).first()).toBeVisible();
});

test("clicking Start on a task claims it and redirects to the action page", async ({ page }) => {
  await sharedLogin(page, STAFF.email, STAFF.password);
  await page.goto("/staff/tasks");

  // At least one Start button must exist — beforeEach abandons stale claims
  // so the seed's claimable tasks are always pickable.
  const startBtn = page.getByRole("button", { name: /^start$/i }).first();
  await expect(startBtn).toBeVisible({ timeout: 10_000 });

  await startBtn.click();

  await expect
    .poll(() => page.url(), { timeout: 15_000 })
    .toMatch(/\/staff\/(bookings|maintenance)/);
});

test("unauthenticated /staff/tasks redirects to login", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/staff/tasks");
  await expect(page).toHaveURL(/login/i);
});
