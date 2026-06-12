import { test, expect } from "../_fixtures/test";
import { BookingWizard } from "../_pom/BookingWizard";

/**
 * Mobile booking wizard (iPhone 14, mobile-customer project). The wizard
 * swaps to the mobile shell below md — steps must still walk and the
 * customer portal's bottom tab bar must navigate.
 */

test.use({ guardMode: "strict" });

test("mobile: wizard steps 1–3 walk on a phone viewport", async ({ page }) => {
  test.setTimeout(120_000);
  const wizard = new BookingWizard(page);
  await wizard.open();
  await wizard.selectDates(20, 2);
  await wizard.selectCategory();
  await wizard.continueStep(2);
  await wizard.chooseNoPreference();
  await wizard.continueStep(3);
  // Step headings are `hidden md:block` — assert step-3 content instead.
  await expect(page.getByRole("button", { name: /helmet|gps unit|lock & chain/i }).first()).toBeVisible();
});

test("mobile: dashboard bottom tab bar navigates", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator("main").first()).toBeVisible();
  // Primary CUSTOMER_NAV items render in the mobile bottom bar.
  const bookingsTab = page.getByRole("link", { name: /my bookings|bookings/i }).last();
  await bookingsTab.click();
  await expect(page).toHaveURL(/\/dashboard\/bookings/);
  // Page headings can be md-only; assert content instead.
  await expect(page.locator("body")).toContainText(/booking|reference|pickup/i);
});
