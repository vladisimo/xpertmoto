import { test, expect } from "../_fixtures/test";

/**
 * Walk-in POS flow — the WalkInBookingSheet modal on /staff/calendar
 * (per the product decision, POS is a modal on the Bookings page, not a
 * standalone page). Creates a real walk-in for the seeded qa.customer:
 * search → pick existing → default date range → pick a vehicle → submit →
 * lands on the new booking ready for check-out.
 */

test.use({ guardMode: "strict" });

test("staff creates a walk-in booking from the calendar", async ({ staffPage }) => {
  test.setTimeout(120_000);
  await staffPage.goto("/staff/calendar");
  await staffPage.getByRole("button", { name: /\+ new walk-in/i }).click();

  // Existing-customer search (depot auto-selects — single-depot seed).
  await staffPage.getByPlaceholder("Start typing…").fill("qa.customer");
  await staffPage.getByText(/qa\.customer@example\.com/).first().click();

  // The default range starts at the next midnight-ish slot, which is
  // outside depot hours and disables submit — pick 10:00 for both pickup
  // and return time explicitly (Radix time comboboxes next to the dates).
  const sheet = staffPage.getByRole("dialog");
  const timeCombos = sheet.getByRole("combobox");
  for (let i = 0; i < 2; i++) {
    await timeCombos.nth(i).click();
    await staffPage.getByRole("option", { name: "10:00" }).first().click();
  }
  await expect(sheet.getByText(/before it opens|after it closes/i)).toHaveCount(0);

  // Availability reloads for the valid window; pick the first vehicle.
  const vehicleButton = sheet.locator("button").filter({ hasText: /km/i }).first();
  await expect(vehicleButton).toBeVisible({ timeout: 20_000 });
  await vehicleButton.click();

  await staffPage
    .getByRole("button", { name: /create booking & proceed to check-out/i })
    .click();

  // Lands on the new booking's check-out (or detail) page.
  await staffPage.waitForURL(/\/staff\/bookings\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(staffPage.locator("body")).toContainText(/check.?out|booking/i);
});
