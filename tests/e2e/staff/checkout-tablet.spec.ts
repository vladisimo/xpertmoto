import { test, expect } from "../_fixtures/test";
import { createConfirmedBooking, completePreHireInspection } from "../_fixtures/factory";

/**
 * Tablet check-out (iPad gen 7, tablet-staff project) — the tablet is the
 * primary inspection device. Verifies the check-out wizard chrome and the
 * verify step work at tablet size, including the MobileBottomBar variant.
 */

test.use({ guardMode: "strict" });

test("tablet: check-out landing + verify step work on iPad", async ({
  customerApi,
  staffApi,
  staffPage,
}) => {
  test.setTimeout(120_000);
  const booking = await createConfirmedBooking(customerApi, { slot: 8, durationDays: 2 });
  await completePreHireInspection(staffApi, booking);

  await staffPage.goto(`/staff/bookings/${booking.bookingId}/check-out`);
  await expect(staffPage.getByRole("heading", { name: /check out/i })).toBeVisible();
  await expect(staffPage.getByText("Done").first()).toBeVisible();

  await staffPage.goto(`/staff/bookings/${booking.bookingId}/check-out/verify`);
  const checks = staffPage.locator('main input[type="checkbox"]');
  await checks.nth(0).check();
  await checks.nth(1).check();
  // Tablet width may render the MobileBottomBar submit instead of the
  // desktop button row — accept either.
  await staffPage
    .getByRole("button", { name: /save & (proceed to signing|continue)/i })
    .first()
    .click();
  await expect(staffPage).toHaveURL(/check-out\/sign/, { timeout: 15_000 });
});
