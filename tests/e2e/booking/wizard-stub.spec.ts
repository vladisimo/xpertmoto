import { test, expect } from "../_fixtures/test";
import { BookingWizard } from "../_pom/BookingWizard";
import { STRIPE_READY } from "../_fixtures/stripe";

/**
 * Full 6-step booking wizard as the signed-in, onboarded seed customer
 * (sarah.smith), in stub-Stripe mode: step 6 creates the booking with
 * pi_stub_* intents, auto-confirms, and redirects to the confirmation page.
 * CI-safe (no Stripe keys). The real-card path lives in payment-stripe.spec.
 *
 * Regression anchor: a returning customer whose profile has licenceType=null
 * (the entire pre-licenceType data set) was silently stuck at step 4 —
 * docs/frontend-test-findings.md #4.
 */

test.use({ guardMode: "strict" });

test.describe("booking wizard — stub payment", () => {
  test.skip(STRIPE_READY, "real-Stripe run: covered by booking/payment-stripe.spec.ts");

  test("onboarded customer completes the wizard end-to-end", async ({ page }) => {
    test.setTimeout(120_000);
    const wizard = new BookingWizard(page);
    await wizard.completeToPayment({ pickupInDays: 5, durationDays: 3 });
    const ref = await wizard.expectConfirmation();
    expect(ref).toMatch(/^[A-Z]{2,4}-\d{8}-/); // e.g. SCT-20260612-AB12CD

    // Confirmation page shows money + bond — GST-inclusive display contract.
    await expect(page.getByText(/paid today/i)).toBeVisible();
    await expect(page.getByText(/bond held/i)).toBeVisible();

    // The booking is visible in the portal.
    await page.goto("/dashboard/bookings");
    await expect(page.getByRole("link", { name: ref })).toBeVisible();
  });

  test("?step URL sync: reload mid-wizard restores state, deep step jump is clamped", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const wizard = new BookingWizard(page);
    await wizard.open();
    await wizard.selectDates(8, 2);
    await wizard.selectCategory();
    await wizard.continueStep(2);

    // Reload: Zustand-persisted state restores the step.
    await page.reload();
    await expect(page).toHaveURL(/step=2/);
    await expect(page.getByRole("button", { name: /no preference/i })).toBeVisible();

    // A hostile/stale deep link can't skip required input past step 4's gate
    // (steps 5+ need the terms acceptance, which we haven't given).
    await page.goto("/booking?step=6");
    await expect(page).not.toHaveURL(/step=6/);
  });

  test("back button walks the wizard steps", async ({ page }) => {
    test.setTimeout(120_000);
    const wizard = new BookingWizard(page);
    await wizard.open();
    await wizard.selectDates(12, 2);
    await wizard.selectCategory();
    await wizard.continueStep(2);
    await wizard.chooseNoPreference();
    await wizard.continueStep(3);
    await page.goBack();
    await expect(page).toHaveURL(/step=2/);
    await page.goBack();
    await expect(page).toHaveURL(/step=1/);
  });
});
