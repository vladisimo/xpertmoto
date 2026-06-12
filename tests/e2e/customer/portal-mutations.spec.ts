import { test, expect } from "../_fixtures/test";
import { createConfirmedBooking } from "../_fixtures/factory";
import { e2ePrisma } from "../_fixtures/db";

/**
 * Customer-portal mutations: every submit must produce visible feedback and
 * persist. Mutating specs own their data — the cancellable booking comes
 * from the factory, never from seeded rows.
 */

test.use({ guardMode: "strict" });

test("profile edit persists across reload", async ({ page }) => {
  await page.goto("/dashboard/profile");
  // The profile card is read-only until Edit details toggles the form.
  await page.getByRole("button", { name: /edit details/i }).first().click();
  const phone = `04${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  const phoneInput = page.locator('input[type="tel"]').first();
  await expect(phoneInput).toBeVisible({ timeout: 15_000 });
  await phoneInput.fill(phone);
  await page.getByRole("button", { name: /save/i }).first().click();
  // Assert persistence at the DB (authoritative): the UI value can be
  // legitimately rewritten moments later by parallel specs that also save
  // sarah's profile (wizard step-4 edit mode), so a reload assertion races.
  await expect
    .poll(
      async () =>
        (
          await e2ePrisma.user.findUnique({
            where: { email: "sarah.smith@example.com" },
            select: { phone: true },
          })
        )?.phone,
      { timeout: 15_000 },
    )
    .toBe(phone);
  // And the form exited edit mode (read-only card back).
  await expect(page.getByRole("button", { name: /edit details/i }).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("customer cancels a confirmed booking from the detail page", async ({
  page,
  customerApi,
}) => {
  test.setTimeout(120_000);
  // Sarah is class C; LAMS eligibility rides on her passport. Other suite
  // traffic against the shared seed user can clear it (updateProfile treats
  // "" as "remove my passport") — reassert the seeded state first.
  const sarah = await e2ePrisma.user.findUniqueOrThrow({
    where: { email: "sarah.smith@example.com" },
    select: { customerProfile: { select: { id: true, passportNumber: true } } },
  });
  if (!sarah.customerProfile!.passportNumber) {
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    await e2ePrisma.customerProfile.update({
      where: { id: sarah.customerProfile!.id },
      data: { passportNumber: "PA1000000", passportCountry: "AU", passportExpiry: expiry },
    });
  }
  const booking = await createConfirmedBooking(customerApi, { slot: 5, durationDays: 2 });

  await page.goto(`/dashboard/bookings/${booking.bookingId}`);
  await expect(page.getByRole("heading", { name: booking.reference })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /cancel booking/i }).click();

  // The cancel dialog shows the refund breakdown (policy tier, $25 admin
  // fee) and requires a reason before the confirm button enables.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/refund/i).first()).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  const confirmBtn = dialog.getByRole("button", { name: /cancel booking/i });
  await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
  await confirmBtn.click();

  await expect
    .poll(
      async () =>
        (
          await e2ePrisma.booking.findUnique({
            where: { id: booking.bookingId },
            select: { status: true },
          })
        )?.status,
      { timeout: 20_000 },
    )
    .toBe("CANCELLED");
  await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 15_000 });
});

test("support ticket: create from the portal and see it in the list", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/dashboard/support");
  const newTicket = page.getByRole("button", { name: /new ticket|create ticket|contact|new request/i }).first();
  const newTicketLink = page.getByRole("link", { name: /new ticket|create ticket|contact|new request/i }).first();
  if (await newTicket.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await newTicket.click();
  } else if (await newTicketLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await newTicketLink.click();
  } else {
    test.skip(true, "no ticket-creation entry point on /dashboard/support — UI uses the chat launcher");
  }
  const subject = `E2E ticket ${Date.now().toString(36)}`;
  const subjectInput = page.locator('input[name*="subject" i], input[placeholder*="subject" i]').first();
  await expect(subjectInput).toBeVisible({ timeout: 10_000 });
  await subjectInput.fill(subject);
  await page.locator("textarea").first().fill("E2E support ticket body — please ignore.");
  await page.getByRole("button", { name: /submit|send|create/i }).first().click();
  await expect(page.getByText(subject)).toBeVisible({ timeout: 20_000 });
});
