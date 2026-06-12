import { test, expect } from "../_fixtures/test";
import { e2ePrisma } from "../_fixtures/db";
import { crawlTabs } from "../_fixtures/interactions";

/**
 * In-page tab bars that aren't URL-addressable through the nav manifest
 * (the route sweep covers every `?tab=` deep link; this covers Radix tab
 * bars inside detail pages). Strict guard: a tab whose panel query 500s
 * fails even though the panel "rendered".
 */

test.use({ guardMode: "strict" });

test("staff booking detail tabs all render (QA-CONFIRMED)", async ({ page }) => {
  const b = await e2ePrisma.booking.findFirst({
    where: { bookingReference: "QA-CONFIRMED" },
    select: { id: true },
  });
  test.skip(!b, "QA-CONFIRMED booking missing from seed");
  await page.goto(`/staff/bookings/${b!.id}`);
  await expect(page.getByRole("heading", { name: "QA-CONFIRMED" })).toBeVisible();
  const tabs = await crawlTabs(page);
  expect(tabs.length).toBeGreaterThanOrEqual(4); // Overview, Payments, Documents, Activity, Notes
});

test("staff customer detail tabs all render", async ({ page }) => {
  const u = await e2ePrisma.user.findUnique({
    where: { email: "qa.customer@example.com" },
    select: { id: true, customerProfile: { select: { id: true } } },
  });
  test.skip(!u?.customerProfile, "qa.customer missing from seed");
  await page.goto(`/staff/customers/${u!.id}`);
  await expect(page.locator("main").first()).toBeVisible();
  await crawlTabs(page);
});
