import { test, expect } from "@playwright/test";

/**
 * Smoke tests for the public marketing + booking flow. These verify the
 * pages render, the navigation links work, and the booking wizard loads
 * its first step. They intentionally do not complete a full booking —
 * that requires seeded data + Stripe and is covered by the integration
 * test at tests/integration/booking-flow.test.ts.
 */

test("homepage renders hero + primary CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/XPERT Moto/i);
  await expect(page.getByRole("link", { name: /book now/i }).first()).toBeVisible();
});

test.describe("fleet listing", () => {
  test("renders the hero and lists bikes", async ({ page }) => {
    await page.goto("/fleet");
    await expect(page.getByRole("heading", { name: /pick your ride/i })).toBeVisible();
    await expect(page.locator("body")).toContainText(/scooter|motorbike/i);
    // At least one model card with a Book now CTA.
    await expect(
      page.locator("article").getByRole("link", { name: /book now/i }).first(),
    ).toBeVisible();
  });

  test("selecting a use-case tab syncs the ?use= query param", async ({ page }) => {
    await page.goto("/fleet");
    await page.getByRole("tab", { name: /commuting/i }).click();
    await expect(page).toHaveURL(/[?&]use=commuting/);
  });

  test("applying a make filter updates the result count", async ({ page }) => {
    await page.goto("/fleet");
    // Open the make Select and pick the first real make (index 0 is "Any make").
    await page.getByLabel("Filter by make").click();
    await page.getByRole("option").nth(1).click();
    // The count switches to the "N of M bikes shown" form once filtered.
    await expect(page.locator("body")).toContainText(/of \d+ bikes? shown/i);
    await expect(page.getByRole("button", { name: /clear filters/i })).toBeVisible();
  });

  test("a card's Book now navigates into the booking wizard", async ({ page }) => {
    await page.goto("/fleet");
    await page
      .locator("article")
      .getByRole("link", { name: /book now/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/booking/);
  });
});

test("pricing page renders", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.locator("body")).toContainText(/\$/);
});

test("locations page renders depot info", async ({ page }) => {
  await page.goto("/locations");
  // Seeded depot (post single-depot consolidation): XPERT Moto Lewisham.
  await expect(page.locator("body")).toContainText(/lewisham/i);
});

test("booking wizard loads step 1", async ({ page }) => {
  await page.goto("/booking");
  await expect(page.locator("body")).toContainText(/pickup|date|depot/i);
});

test("login page renders form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
