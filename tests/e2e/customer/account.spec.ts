import { test, expect } from "@playwright/test";

/**
 * Authenticated customer portal (runs with the seeded, fully-onboarded
 * sarah.smith@example.com session from auth.setup → STORAGE_STATE.customer).
 * Verifies the portal is reachable past the onboarding gate and surfaces the
 * customer's own identity.
 */

test("customer dashboard is reachable without hitting the onboarding gate", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  // An un-onboarded session would have been bounced to /onboarding.
  await expect(page).not.toHaveURL(/\/onboarding/);
  await expect(page.locator("body")).toContainText(/booking|dashboard|welcome|trips?/i);
});

test("profile page shows the signed-in customer's details", async ({ page }) => {
  await page.goto("/dashboard/profile");
  await expect(page).toHaveURL(/\/dashboard\/profile/);
  await expect(page.locator("body")).toContainText(/sarah/i);
  await expect(page.locator("body")).toContainText(/sarah\.smith@example\.com/i);
});

test("customer can open the bookings/trips area", async ({ page }) => {
  await page.goto("/dashboard/bookings");
  // Either the bookings list renders, or we stayed authenticated on the portal.
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator("body")).toContainText(/booking|trip|reservation|no bookings/i);
});
