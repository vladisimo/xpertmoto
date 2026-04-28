import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

/**
 * /staff/tasks smoke. Depends on seeded credentials and at least one
 * actionable booking for today at the staff member's depot. Before each
 * test we release any stale IN_PROGRESS task activities so earlier runs
 * don't hold the partial-unique lock.
 */

const STAFF = { email: "staff.gold-coast@scootering.com.au", password: "staff1234" };

test.beforeEach(async () => {
  // Release any stale IN_PROGRESS activities so the seeded claimable tasks
  // (today's pickups, overdue returns) are pickable again.
  await prisma.staffTaskActivity.updateMany({
    where: { status: "IN_PROGRESS" },
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

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', STAFF.email);
  await page.fill('input[type="password"]', STAFF.password);
  await Promise.all([
    page
      .waitForURL((url) => !/\/login(\?|$)/.test(url.toString()), { timeout: 30_000 })
      .catch(() => undefined),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
}

test("staff can open Priority Tasks page and see the queue chrome", async ({ page }) => {
  await login(page);
  await page.goto("/staff/tasks");

  await expect(page.getByRole("heading", { name: /priority tasks/i })).toBeVisible();

  // KPI labels always render regardless of row count.
  await expect(page.getByText(/open tasks/i)).toBeVisible();
  await expect(page.getByText(/in progress/i)).toBeVisible();
  await expect(page.getByText(/urgent/i).first()).toBeVisible();

  // Filter bar + pagination primitives render.
  await expect(page.getByText(/priority/i).first()).toBeVisible();
  await expect(page.getByText(/rows per page/i)).toBeVisible();
});

test("clicking Start on a task claims it and redirects to the action page", async ({ page }) => {
  await login(page);
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
