import type { Page } from "@playwright/test";
import { fillStripeCard, STRIPE_TEST_CARDS } from "../_fixtures/stripe";

export type BookingDetails = {
  email: string;
  firstName: string;
  lastName: string;
  licenceNumber: string;
};

/**
 * Page object for the public 6-step booking wizard at /booking.
 *
 * Steps (from CLAUDE.md → "Multi-Step Booking Wizard"):
 *   1. Search & Availability
 *   2. Vehicle Selection
 *   3. Extras & Insurance
 *   4. Customer Details
 *   5. Review & Terms
 *   6. Payment
 *
 * Selectors that match the existing `tests/e2e/booking-payment.spec.ts` are
 * lifted verbatim. Selectors marked TODO need DOM verification when the
 * concrete spec is written — the wizard component lives in
 * `src/components/booking/booking-wizard-client.tsx`.
 */
export class BookingWizard {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/booking");
  }

  async fillSearch(opts: { depot: string; pickupDate: string; returnDate: string }): Promise<void> {
    await this.page.getByLabel("Pickup depot").selectOption({ label: opts.depot });
    await this.page.getByLabel("Pickup date").fill(opts.pickupDate);
    await this.page.getByLabel("Return date").fill(opts.returnDate);
    await this.continue();
  }

  async pickVehicle(categoryLabel: RegExp = /50cc/i): Promise<void> {
    await this.page.getByRole("radio", { name: categoryLabel }).first().check();
    await this.continue();
  }

  async skipExtras(): Promise<void> {
    // helmet is required and pre-checked; skip optional addons
    await this.continue();
  }

  async addExtra(_addonName: string): Promise<void> {
    // TODO confirm checkbox label shape once extras step DOM is verified
    await this.page.getByRole("checkbox", { name: new RegExp(_addonName, "i") }).check();
  }

  async fillCustomerDetails(d: BookingDetails): Promise<void> {
    await this.page.getByLabel("Email").fill(d.email);
    await this.page.getByLabel("First name").fill(d.firstName);
    await this.page.getByLabel("Last name").fill(d.lastName);
    await this.page.getByLabel("Licence number").fill(d.licenceNumber);
    await this.continue();
  }

  async acceptTerms(): Promise<void> {
    await this.page.getByRole("checkbox", { name: /agree to terms/i }).check();
    await this.continue();
  }

  async pay(card: keyof typeof STRIPE_TEST_CARDS = "success"): Promise<void> {
    await fillStripeCard(this.page, { number: STRIPE_TEST_CARDS[card] });
    await this.page.getByRole("button", { name: /pay/i }).click();
  }

  async continue(): Promise<void> {
    await this.page.getByRole("button", { name: /continue|next/i }).click();
  }

  /** Drive the entire happy path with sensible defaults. */
  async completeHappyPath(opts: {
    depot: string;
    pickupDate: string;
    returnDate: string;
    customer: BookingDetails;
    card?: keyof typeof STRIPE_TEST_CARDS;
  }): Promise<void> {
    await this.open();
    await this.fillSearch({
      depot: opts.depot,
      pickupDate: opts.pickupDate,
      returnDate: opts.returnDate,
    });
    await this.pickVehicle();
    await this.skipExtras();
    await this.fillCustomerDetails(opts.customer);
    await this.acceptTerms();
    await this.pay(opts.card ?? "success");
  }
}
