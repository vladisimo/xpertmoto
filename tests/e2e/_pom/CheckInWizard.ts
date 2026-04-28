import type { Page } from "@playwright/test";

/**
 * Page object for the staff check-in wizard at
 * `/staff/bookings/[id]/check-in/{inspect,assess,settle,sign}`.
 *
 * Subroutes (from filesystem inspection):
 *   inspect → post-hire inspection (photos, return odometer, fuel)
 *   assess  → damage tariff drag-drop on vehicle outline
 *   settle  → final charges, bond capture vs release
 *   sign    → customer sign-off, transition to COMPLETED
 *
 * Selectors marked TODO are deferred to Phase 3 spec implementation; the
 * intent here is the API surface specs will compose against.
 */
export class CheckInWizard {
  constructor(private readonly page: Page, private readonly bookingId: string) {}

  async open(): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-in/inspect`);
  }

  async fillReturnInspection(opts: {
    odometerKm: number;
    fuelPercent: number;
  }): Promise<void> {
    await this.page.getByLabel(/odometer/i).fill(String(opts.odometerKm));
    await this.page.getByLabel(/fuel/i).fill(String(opts.fuelPercent));
    await this.next();
  }

  async addDamageCharge(opts: {
    component: string;
    amount: number;
    photoPath?: string;
  }): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-in/assess`);
    // TODO — drag-drop tariff onto vehicle SVG. Likely uses @dnd-kit;
    // exposes data-tariff-id / data-zone attributes worth grepping for.
    await this.page
      .locator(`[data-tariff-component="${opts.component}"]`)
      .click();
    await this.page.getByLabel(/amount/i).fill(opts.amount.toFixed(2));
    if (opts.photoPath) {
      await this.page.setInputFiles('input[type="file"]', opts.photoPath);
    }
    await this.page.getByRole("button", { name: /add charge|save/i }).click();
  }

  async settle(opts: { captureBondAmount?: number } = {}): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-in/settle`);
    if (opts.captureBondAmount !== undefined) {
      await this.page.getByLabel(/capture/i).fill(opts.captureBondAmount.toFixed(2));
    }
    await this.page.getByRole("button", { name: /settle|finalise/i }).click();
  }

  async sign(): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-in/sign`);
    // TODO — signature canvas; same caveats as CheckOutWizard.sign()
    await this.page.getByRole("button", { name: /complete|finish/i }).click();
  }

  private async next(): Promise<void> {
    await this.page.getByRole("button", { name: /continue|next|save/i }).click();
  }
}
