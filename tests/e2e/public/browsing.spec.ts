import { test, expect } from "../_fixtures/test";
import { bookingRefData } from "../_fixtures/pricing";

/**
 * Public, unauthenticated browsing across the marketing surface, plus a
 * UI↔API price-parity check on the booking wizard's category picker (the
 * "from A$X/day" rate the customer first sees must equal the engine's
 * baseDailyRate). The deeper 6-step wizard + payment flow is driven in
 * tests/e2e/booking/ (see the BookingWizard page object).
 */

test.describe("marketing browsing", () => {
  test("homepage shows brand + primary booking CTA", async ({ page }) => {
    await page.goto("/");
    // Brand name is tenant-configurable (getBranding), so assert on the
    // product noun rather than a hardcoded trading name.
    await expect(page).toHaveTitle(/scooter|moto|hire|ride/i);
    await expect(page.getByRole("link", { name: /book now/i }).first()).toBeVisible();
  });

  test("fleet page lists rentable bikes", async ({ page }) => {
    await page.goto("/fleet");
    await expect(page.locator("body")).toContainText(/scooter|motorbike|motorcycle/i);
    await expect(
      page.locator("article").getByRole("link", { name: /book now/i }).first(),
    ).toBeVisible();
  });

  test("a fleet card deep-links into the booking wizard", async ({ page }) => {
    await page.goto("/fleet");
    await page.locator("article").getByRole("link", { name: /book now/i }).first().click();
    await expect(page).toHaveURL(/\/booking/);
  });

  test("pricing page renders dollar amounts", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator("body")).toContainText(/\$/);
  });

  test("locations page renders depot info", async ({ page }) => {
    await page.goto("/locations");
    await expect(page.locator("body")).toContainText(/lewisham/i);
  });
});

test.describe("booking wizard — first impression", () => {
  test("step 1 renders and its category rate matches the pricing engine", async ({
    page,
    publicApi,
  }) => {
    const ref = await bookingRefData(publicApi);
    const categories = await publicApi.vehicle.listCategories.query();
    const cat = categories[0]!;
    const expectedRate = Number(cat.baseDailyRate);

    await page.goto("/booking");
    await expect(page.getByRole("heading", { name: /when & where/i })).toBeVisible();

    // The category picker advertises "from A$<rate>/day". That figure is read
    // straight from the same baseDailyRate the engine quotes against, so a
    // mismatch here means the storefront and the engine have drifted apart.
    await page.getByRole("combobox").filter({ hasText: /select a category/i }).click();
    const option = page.getByRole("option", { name: new RegExp(ref.categoryName, "i") });
    await expect(option).toContainText(new RegExp(`A\\$${expectedRate.toFixed(0)}/day`));
  });
});
