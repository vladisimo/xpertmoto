import { test, expect } from "../_fixtures/test";
import { createConfirmedBooking, completePreHireInspection } from "../_fixtures/factory";
import { e2ePrisma } from "../_fixtures/db";

/**
 * Full staff rental lifecycle on a factory-created booking (never the shared
 * QA-CONFIRMED fixture — retries must find fresh state):
 *
 *   stub-confirmed booking → pre-hire inspection (API, mirrors seed)
 *   → check-out wizard: verify (UI) → sign (tRPC: the same
 *     startDraft/saveSignature/finalise chain the TabletSignaturePad calls —
 *     canvas drawing itself is covered by damage-map.spec)
 *   → confirm handover (UI) → ACTIVE
 *   → mark returned + complete via the booking-detail StatusActions (UI)
 *   → COMPLETED, vehicle back to AVAILABLE.
 *
 * Serial: each step depends on the previous one's server state.
 */

// 1×1 transparent PNG — the smallest payload agreement.saveSignature accepts.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const AGREEMENT_PAGES = ["cover", "pricing", "condition", "terms", "bond-policy", "declarations"] as const;

test.describe.serial("check-out → check-in lifecycle", () => {
  test.use({ guardMode: "strict" });

  let bookingId: string;
  let reference: string;

  test("setup: factory booking is CONFIRMED with vehicle + pre-hire inspection", async ({
    customerApi,
    staffApi,
  }) => {
    const booking = await createConfirmedBooking(customerApi, { slot: 1, durationDays: 3 });
    expect(booking.vehicleId, "stub confirm allocates a vehicle").toBeTruthy();
    await completePreHireInspection(staffApi, booking);
    bookingId = booking.bookingId;
    reference = booking.reference;
  });

  test("check-out landing shows inspection done; verify step saves", async ({ staffPage }) => {
    await staffPage.goto(`/staff/bookings/${bookingId}/check-out`);
    await expect(staffPage.getByRole("heading", { name: /pre-hire inspection/i })).toBeVisible();
    await expect(staffPage.getByText("Done").first()).toBeVisible();

    await staffPage.goto(`/staff/bookings/${bookingId}/check-out/verify`);
    const checks = staffPage.locator('main input[type="checkbox"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();
    await staffPage.getByRole("button", { name: /save & proceed to signing/i }).click();
    await expect(staffPage).toHaveURL(/check-out\/sign/, { timeout: 15_000 });
  });

  test("agreement signs (tRPC chain) and handover completes via the UI", async ({
    staffApi,
    staffPage,
  }) => {
    const draft = await staffApi.agreement.startDraft.mutate({ bookingId });
    for (const pageId of AGREEMENT_PAGES) {
      await staffApi.agreement.saveSignature.mutate({
        agreementId: draft.id,
        kind: "initials",
        pageId,
        dataUrl: TINY_PNG,
      });
    }
    await staffApi.agreement.saveSignature.mutate({
      agreementId: draft.id,
      kind: "full-customer",
      dataUrl: TINY_PNG,
    });
    await staffApi.agreement.saveSignature.mutate({
      agreementId: draft.id,
      kind: "full-staff",
      dataUrl: TINY_PNG,
    });
    await staffApi.agreement.finalise.mutate({ agreementId: draft.id });

    // Confirm handover through the UI: keys checkbox gates the submit.
    await staffPage.goto(`/staff/bookings/${bookingId}/check-out/confirm`);
    const completeBtn = staffPage.getByRole("button", { name: /complete check-out/i });
    await expect(completeBtn).toBeVisible({ timeout: 15_000 });
    await staffPage.locator('main input[type="checkbox"]').first().check();
    await completeBtn.click();

    await expect
      .poll(
        async () =>
          (await e2ePrisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } }))
            ?.status,
        { timeout: 20_000 },
      )
      .toMatch(/ACTIVE|CHECKED_OUT/);
  });

  test("status actions return + complete the hire from the booking detail", async ({
    staffPage,
  }) => {
    await staffPage.goto(`/staff/bookings/${bookingId}`);
    await expect(staffPage.getByRole("heading", { name: reference })).toBeVisible();

    // → Returned (skip settlement): no damage on this hire.
    await staffPage.getByRole("button", { name: /change status/i }).click();
    await staffPage.getByText(/→ returned \(skip settlement\)/i).click();
    // The inline prompt asks for odometer/fuel (ReturnedInline) — fill any
    // numeric inputs it renders, then submit.
    const numberInputs = staffPage.locator('input[type="number"]');
    const numericCount = await numberInputs.count();
    for (let i = 0; i < numericCount; i++) {
      const val = (await numberInputs.nth(i).inputValue()).trim();
      if (!val) await numberInputs.nth(i).fill(i === 0 ? "1100" : "80");
    }
    await staffPage.getByRole("button", { name: /^(confirm|save|return|mark returned|submit)/i }).first().click();
    await expect
      .poll(
        async () =>
          (await e2ePrisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } }))
            ?.status,
        { timeout: 20_000 },
      )
      .toBe("RETURNED");

    // → Completed.
    await staffPage.getByRole("button", { name: /change status/i }).click();
    await staffPage.getByText(/→ completed/i).click();
    await staffPage.getByRole("button", { name: /^(confirm|save|complete|submit)/i }).first().click();
    await expect
      .poll(
        async () =>
          (await e2ePrisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } }))
            ?.status,
        { timeout: 20_000 },
      )
      .toBe("COMPLETED");

    // Vehicle is rentable again.
    const vehicle = await e2ePrisma.booking.findUnique({
      where: { id: bookingId },
      select: { vehicle: { select: { status: true } } },
    });
    expect(vehicle?.vehicle?.status).toBe("AVAILABLE");
  });
});
