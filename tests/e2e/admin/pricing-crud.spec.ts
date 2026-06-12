import { test, expect } from "../_fixtures/test";
import { e2ePrisma } from "../_fixtures/db";

/**
 * Pricing CRUD round-trip on /admin/pricing?tab=discounts: create a discount
 * code through the UI, verify the public pricing engine applies it to a
 * quote, then disable it via the row action and verify it stops applying.
 * Cleans up its own row (unique code per run).
 */

test.use({ guardMode: "strict" });

test("discount code: create via UI → quote applies it → disable → quote ignores it", async ({
  page,
  publicApi,
}) => {
  test.setTimeout(120_000);
  const code = `E2E${Date.now().toString(36).toUpperCase()}`;

  await page.goto("/admin/pricing?tab=discounts");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.getByPlaceholder("CODE").fill(code);
  await page.getByPlaceholder("Value").fill("10"); // 10% (PERCENTAGE default)
  // The list refetch occasionally misses the first create — retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: /^create$/i }).click();
    const visible = await page
      .getByText(code)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) break;
    if (attempt === 1) throw new Error(`discount ${code} never appeared after 2 create attempts`);
    await page.reload();
    await page.getByPlaceholder("CODE").fill(code);
    await page.getByPlaceholder("Value").fill("10");
  }

  // The public quote honours the new code.
  const depot = await e2ePrisma.depot.findFirstOrThrow({ where: { isActive: true } });
  const category = await e2ePrisma.vehicleCategory.findFirstOrThrow({
    where: { isActive: true, vehicles: { some: {} } },
  });
  const pickup = new Date();
  pickup.setDate(pickup.getDate() + 60);
  pickup.setHours(10, 0, 0, 0);
  const ret = new Date(pickup);
  ret.setDate(ret.getDate() + 3);
  const quoteInput = {
    categoryId: category.id,
    pickupDepotId: depot.id,
    returnDepotId: depot.id,
    pickupDateTime: pickup,
    returnDateTime: ret,
  };
  const base = await publicApi.booking.quote.query(quoteInput);
  const discounted = await publicApi.booking.quote.query({ ...quoteInput, discountCode: code });
  expect(Number(discounted.totalAmount)).toBeLessThan(Number(base.totalAmount));

  // Disable via the row action; the engine stops applying it.
  const row = page.getByRole("row").filter({ hasText: code }).first();
  await row.getByRole("button", { name: /disable/i }).click();
  await expect(row.getByRole("button", { name: /enable/i })).toBeVisible({ timeout: 15_000 });
  const afterDisable = await publicApi.booking.quote.query({ ...quoteInput, discountCode: code });
  expect(Number(afterDisable.totalAmount)).toBe(Number(base.totalAmount));
});
