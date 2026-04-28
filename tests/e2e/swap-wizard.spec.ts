import { test, expect } from "@playwright/test";

/**
 * Mid-rental vehicle swap — wizard reachability smoke.
 *
 * Full end-to-end verification of the commit path (Stripe upcharge/refund
 * settlement, PDF upload, work-order creation, customer notification)
 * requires a seeded ACTIVE booking with a SUCCEEDED BOOKING_PAYMENT and
 * a stored Stripe customer PM. That fixture isn't guaranteed in CI, so
 * this spec walks the first two steps of the wizard only and asserts the
 * right UI primitives render. Full router coverage is in the Vitest suite
 * at tests/unit/trpc/router/booking-swap.test.ts.
 *
 * Skips gracefully when the seed doesn't expose a swappable booking.
 */

const STAFF = { email: "staff.gold-coast@scootering.com.au", password: "staff1234" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', STAFF.email);
  await page.fill('input[type="password"]', STAFF.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/staff/i, { timeout: 10_000 }).catch(() => undefined);
}

async function findSwappableBookingId(
  page: import("@playwright/test").Page,
): Promise<string | null> {
  // The wizard gates on status ∈ {ACTIVE, CHECKED_OUT, OVERDUE}. Pull a
  // page of bookings from the staff list endpoint and filter.
  const input = encodeURIComponent(JSON.stringify({ 0: { json: { take: 25 } } }));
  const resp = await page
    .evaluate(async (url) => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    }, `/api/trpc/staffBooking.list?batch=1&input=${input}`)
    .catch(() => null);
  try {
    const arr = resp as
      | Array<{
          result?: {
            data?: {
              json?: {
                items?: Array<{ id: string; status: string; vehicleId: string | null }>;
              };
            };
          };
        }>
      | null;
    const items = arr?.[0]?.result?.data?.json?.items ?? [];
    const hit = items.find(
      (b) => ["ACTIVE", "CHECKED_OUT", "OVERDUE"].includes(b.status) && b.vehicleId,
    );
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

test("swap wizard loads at the Reason step with Reason + Origin selects", async ({ page }) => {
  await login(page);

  const bookingId = await findSwappableBookingId(page);
  if (!bookingId) {
    test.skip(true, "No ACTIVE/CHECKED_OUT/OVERDUE booking with a vehicle seeded — skipping.");
    return;
  }

  await page.goto(`/staff/bookings/${bookingId}/swap`);
  await page.waitForLoadState("networkidle");

  // Page header
  await expect(page.getByRole("heading", { name: /swap vehicle/i })).toBeVisible();

  // Step 1 section title
  await expect(
    page.getByRole("heading", { name: /why is this vehicle changing/i }),
  ).toBeVisible();

  // Both selects rendered — shadcn <Select> exposes comboboxes.
  const comboboxes = page.getByRole("combobox");
  await expect(comboboxes).toHaveCount(2, { timeout: 5_000 });

  // Reason options appear when the first select is opened.
  await comboboxes.nth(0).click();
  await expect(page.getByRole("option", { name: /mechanical fault/i })).toBeVisible();
  await expect(page.getByRole("option", { name: /lateral/i })).toBeVisible();
  await expect(page.getByRole("option", { name: /upgrade/i })).toBeVisible();

  // Continue button is disabled until reason + origin + notes are filled.
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: /continue|starting/i }),
  ).toBeDisabled();
});

test("swap wizard shows a Cancel swap action", async ({ page }) => {
  await login(page);
  const bookingId = await findSwappableBookingId(page);
  if (!bookingId) {
    test.skip(true, "No swappable booking seeded — skipping.");
    return;
  }

  await page.goto(`/staff/bookings/${bookingId}/swap`);
  await expect(page.getByRole("button", { name: /cancel swap/i })).toBeVisible();
});
