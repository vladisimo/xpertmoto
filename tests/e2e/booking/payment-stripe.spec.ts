import { test, expect } from "../_fixtures/test";
import { BookingWizard } from "../_pom/BookingWizard";
import { STRIPE_READY } from "../_fixtures/stripe";

/**
 * Tier-2: booking → payment → confirmation against REAL Stripe test mode.
 * Local-only — run via `npm run test:e2e:stripe` with STRIPE_TEST_SECRET_KEY
 * and STRIPE_TEST_PUBLISHABLE_KEY exported (scripts/dev-e2e.mjs maps them
 * onto the live var names for that server run). Skipped otherwise; the
 * stub-mode funnel in wizard-stub.spec.ts is the CI path.
 *
 * Cards (Stripe documented test numbers, via _fixtures/stripe.ts):
 *   4242…4242 succeeds · 4000 0027 6000 3184 requires 3DS ·
 *   4000…9995 declines (insufficient funds)
 */

test.use({ guardMode: "report" }); // Stripe iframes emit cross-frame noise; flows assert outcomes

test.describe("booking → payment → confirmation (Stripe test mode)", () => {
  test.skip(!STRIPE_READY, "STRIPE_TEST_* env not set — skipping Stripe-dependent specs");

  test("happy path with 4242 — booking confirmed", async ({ page }) => {
    test.setTimeout(180_000);
    const wizard = new BookingWizard(page);
    await wizard.completeToPayment({ pickupInDays: 4, durationDays: 3 });
    await expect(page).toHaveURL(/step=6/);
    await wizard.pay("success");
    const ref = await wizard.expectConfirmation();
    expect(ref).toBeTruthy();
  });

  test("decline with 4000…9995 — visible error, then retry with 4242 succeeds", async ({ page }) => {
    test.setTimeout(240_000);
    const wizard = new BookingWizard(page);
    await wizard.completeToPayment({ pickupInDays: 9, durationDays: 3 });
    await expect(page).toHaveURL(/step=6/);

    await wizard.pay("decline");
    // The decline must surface visibly — silence here is the bug we hunt.
    await expect(
      page.getByText(/declined|insufficient|could not|failed|try (again|another)/i).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/confirmation/);

    // The payment form stays usable: retry with a good card (idempotent
    // confirm path — booking was created PENDING_PAYMENT on first attempt).
    await wizard.pay("success");
    await wizard.expectConfirmation();
  });

  test("3DS challenge with 4000 0027 6000 3184 — authenticates then confirms", async ({ page }) => {
    test.setTimeout(240_000);
    const wizard = new BookingWizard(page);
    await wizard.completeToPayment({ pickupInDays: 14, durationDays: 3 });
    await expect(page).toHaveURL(/step=6/);
    await wizard.pay("requires3ds"); // pay() completes the 3DS challenge frame
    await wizard.expectConfirmation();
  });
});
