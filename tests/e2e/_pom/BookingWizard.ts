import { expect, type Page } from "@playwright/test";
import { fillStripeCard, completeStripe3dsChallenge, STRIPE_TEST_CARDS } from "../_fixtures/stripe";

/**
 * Page object for the public 6-step booking wizard at /booking.
 * Selectors verified against the live DOM (June 2026):
 *
 *  1. Search — react-day-picker two-month range calendar (day buttons named
 *     "Monday, June 15th, 2026"), two Radix time comboboxes (default 10:00
 *     once dates picked), one Radix category combobox, Continue.
 *  2. Vehicle — "No preference" toggle button OR vehicle card buttons,
 *     filter bar, Continue.
 *  3. Extras — add-on toggle buttons (helmet pre-included), insurance
 *     option buttons, Continue.
 *  4. Details — review mode ("Review your details" + Continue) for an
 *     onboarded customer; edit form otherwise. Guests see a sign-in gate
 *     (wizard_inline_auth off) with /login?callbackUrl=/booking links.
 *  5. Review & terms — THREE checkboxes (terms, privacy, accept-policy) +
 *     "Continue to payment".
 *  6. Payment — stub mode auto-creates + confirms and redirects to
 *     /booking/confirmation?ref=…; real Stripe mode renders PaymentElement.
 */
export class BookingWizard {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/booking");
    await expect(this.page).toHaveURL(/\/booking\?step=\d/);
  }

  /**
   * Accessible-name regex for a calendar day. The picker's custom a11y
   * labels are day-first en-AU with an availability suffix, e.g.
   * "Monday 17 August 2026, available" — match on the date portion only
   * (the leading \b stops "7 August" from matching inside "17 August").
   */
  private dayName(d: Date): RegExp {
    const month = d.toLocaleString("en-AU", { month: "long" });
    return new RegExp(`\\b${d.getDate()} ${month} ${d.getFullYear()}\\b`);
  }

  /**
   * Pick the pickup/return range on the two-month calendar. Dates within
   * ~6 weeks are visible without month navigation. If the exact day button
   * is disabled (depot closed), slides forward up to 3 days.
   */
  async selectDates(pickupInDays: number, durationDays: number): Promise<{ pickup: Date; ret: Date }> {
    // Day cells render enabled/disabled from depot data — wait for the grid
    // to hydrate before probing candidates (slow CI runners lag here).
    await this.page
      .getByRole("grid")
      .first()
      .getByRole("button")
      .first()
      .waitFor({ timeout: 15_000 });
    const clickFirstEnabled = async (start: Date): Promise<Date> => {
      for (let slide = 0; slide < 4; slide++) {
        const d = new Date(start);
        d.setDate(d.getDate() + slide);
        const btn = this.page.getByRole("button", { name: this.dayName(d) });
        if ((await btn.count()) > 0 && (await btn.first().isEnabled())) {
          await btn.first().click();
          return d;
        }
      }
      throw new Error(`no enabled calendar day near ${start.toDateString()}`);
    };
    const pickupTarget = new Date();
    pickupTarget.setDate(pickupTarget.getDate() + pickupInDays);
    const pickup = await clickFirstEnabled(pickupTarget);
    const retTarget = new Date(pickup);
    retTarget.setDate(retTarget.getDate() + durationDays);
    const ret = await clickFirstEnabled(retTarget);
    // Time comboboxes enable once dates are picked (default 10:00).
    await expect(this.page.getByRole("combobox").first()).toBeEnabled();
    return { pickup, ret };
  }

  /** Open the category combobox (the last combobox on step 1) and pick an option. */
  async selectCategory(label?: RegExp): Promise<void> {
    const combos = this.page.getByRole("combobox");
    await combos.last().click();
    const options = this.page.getByRole("option");
    const target = label ? options.filter({ hasText: label }).first() : options.first();
    await expect(target).toBeVisible();
    await target.click();
  }

  async chooseNoPreference(): Promise<void> {
    await this.page.getByRole("button", { name: /no preference/i }).click();
  }

  async addExtra(addonName: RegExp): Promise<void> {
    await this.page.getByRole("button", { name: addonName }).first().click();
  }

  /**
   * Accept every step-5 checkbox and continue to payment. First-time
   * customers see three (platform terms + privacy are one-time consents);
   * repeat customers see only the per-booking policy acceptance. The
   * platform-consent block hydrates from an async consentStatus query, so
   * boxes can appear AFTER the page looks ready — check, attempt, and
   * re-check anything that materialised late.
   */
  async acceptTermsAndContinue(): Promise<void> {
    await expect(this.page.getByRole("button", { name: /continue to payment/i })).toBeVisible({
      timeout: 15_000,
    });
    await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    for (let attempt = 0; attempt < 3; attempt++) {
      const boxes = this.page.getByRole("checkbox");
      const count = await boxes.count();
      expect(count, "step 5 renders at least the policy-acceptance checkbox").toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = boxes.nth(i);
        if (!(await box.isChecked())) await box.check();
      }
      await this.page.getByRole("button", { name: /continue to payment/i }).click();
      const advanced = await this.page
        .waitForURL((u) => !/step=5/.test(u.toString()), { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (advanced) return;
    }
    throw new Error("step 5: Continue to payment did not advance after 3 attempts");
  }

  async continueStep(expectedNextStep?: number): Promise<void> {
    const button = this.page
      .locator("main")
      .first()
      .getByRole("button", { name: /^(continue|save & continue)$/i })
      .first();
    if (!expectedNextStep) {
      await button.click();
      return;
    }
    // Step 4 hydrates the wizard store from the customer profile in an
    // effect AFTER the review UI paints; a click in that one-frame window is
    // a silent no-op (store clamp). Humans never notice; a single robotic
    // click does. Re-click up to 3 times before calling the button dead.
    for (let attempt = 0; attempt < 3; attempt++) {
      await button.click();
      try {
        await expect(this.page).toHaveURL(new RegExp(`step=${expectedNextStep}`), {
          timeout: 2_000,
        });
        return;
      } catch {
        // retry
      }
    }
    throw new Error(
      `Dead Continue: 3 clicks did not advance the wizard to step ${expectedNextStep} (still at ${this.page.url()})`,
    );
  }

  /** Real-Stripe mode only: fill the PaymentElement and submit. */
  async pay(card: keyof typeof STRIPE_TEST_CARDS = "success"): Promise<void> {
    await fillStripeCard(this.page, { number: STRIPE_TEST_CARDS[card] });
    await this.page.getByRole("button", { name: /pay|confirm/i }).first().click();
    if (card === "requires3ds") {
      await completeStripe3dsChallenge(this.page);
    }
  }

  /** Wait for the confirmation page and return the booking reference. */
  async expectConfirmation(): Promise<string> {
    await this.page.waitForURL(/\/booking\/confirmation\?ref=/, { timeout: 30_000 });
    await expect(this.page.getByRole("heading", { name: /booking confirmed/i })).toBeVisible();
    const ref = new URL(this.page.url()).searchParams.get("ref");
    expect(ref, "confirmation page carries a booking reference").toBeTruthy();
    return ref!;
  }

  /**
   * Steps 1–5 for a signed-in, onboarded customer (storage-state session).
   * Leaves the wizard at step 6; in stub mode step 6 immediately confirms.
   */
  async completeToPayment(opts: { pickupInDays?: number; durationDays?: number } = {}): Promise<void> {
    await this.open();
    await this.selectDates(opts.pickupInDays ?? 3, opts.durationDays ?? 3);
    await this.selectCategory();
    await this.continueStep(2);
    await this.chooseNoPreference();
    await this.continueStep(3);
    await this.continueStep(4); // extras are optional
    await this.continueStep(5); // details review mode
    await this.acceptTermsAndContinue();
  }
}
