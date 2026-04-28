import type { Page } from "@playwright/test";

/**
 * Page object for the staff check-out wizard at
 * `/staff/bookings/[id]/check-out/{inspect,sign,confirm,verify}`.
 *
 * Subroutes (from filesystem inspection):
 *   inspect → pre-hire inspection (photos, odometer, fuel, damage map)
 *   sign    → customer signature + licence verification
 *   confirm → final review, transition to ACTIVE
 *   verify  → terminal verification step
 *
 * All selectors are TODO until the actual DOM is inspected during Phase 3
 * spec writing. The intent of this skeleton is to fix the API shape so
 * specs can be written top-down.
 */
export class CheckOutWizard {
  constructor(private readonly page: Page, private readonly bookingId: string) {}

  async open(): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-out/inspect`);
  }

  async fillInspection(opts: {
    odometerKm: number;
    fuelPercent: number;
    overallCondition?: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  }): Promise<void> {
    // TODO selectors — confirm during Phase 3
    await this.page.getByLabel(/odometer/i).fill(String(opts.odometerKm));
    await this.page.getByLabel(/fuel/i).fill(String(opts.fuelPercent));
    if (opts.overallCondition) {
      await this.page
        .getByRole("radio", { name: new RegExp(opts.overallCondition, "i") })
        .check();
    }
    await this.next();
  }

  async addDamageMarker(opts: { zone: string; severity: "MINOR" | "MODERATE" | "MAJOR" }): Promise<void> {
    // TODO — the body damage map is an SVG with clickable zones; needs
    // page.locator(`[data-zone="${opts.zone}"]`).click() pattern verified.
    await this.page.locator(`[data-damage-zone="${opts.zone}"]`).click();
    await this.page
      .getByRole("radio", { name: new RegExp(opts.severity, "i") })
      .check();
  }

  async uploadPhoto(filePath: string): Promise<void> {
    await this.page.setInputFiles('input[type="file"]', filePath);
  }

  async sign(opts: { customerSignaturePng?: string; staffSignaturePng?: string } = {}): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-out/sign`);
    // TODO — signature is a canvas; either drag-draw via mouse events or
    // upload a pre-rendered PNG via a hidden file input if the component
    // supports it. Confirm the affordance during spec writing.
    if (opts.customerSignaturePng || opts.staffSignaturePng) {
      throw new Error("CheckOutWizard.sign(): file-upload mode not yet wired");
    }
    await this.next();
  }

  async confirm(): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-out/confirm`);
    await this.page.getByRole("button", { name: /confirm|check out/i }).click();
  }

  async verify(): Promise<void> {
    await this.page.goto(`/staff/bookings/${this.bookingId}/check-out/verify`);
    // TODO — verify final state copy
  }

  private async next(): Promise<void> {
    await this.page.getByRole("button", { name: /continue|next|save/i }).click();
  }
}
