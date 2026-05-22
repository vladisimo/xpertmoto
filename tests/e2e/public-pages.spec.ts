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

test("fleet page lists vehicle categories", async ({ page }) => {
  await page.goto("/fleet");
  await expect(page.locator("body")).toContainText(/scooter|motorbike/i);
});

test("pricing page renders", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.locator("body")).toContainText(/\$/);
});

test("locations page renders depot info", async ({ page }) => {
  await page.goto("/locations");
  await expect(page.locator("body")).toContainText(/gold coast|byron|noosa/i);
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
