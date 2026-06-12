import { test as base, expect } from "../_fixtures/test";

/**
 * Guest entry into the booking wizard. Runs in the `customer` project but
 * with an EMPTY storage state — the point is the anonymous path: steps 1–3
 * work without a session, step 4 shows the sign-in gate (wizard_inline_auth
 * is off in the e2e seed), and wizard state survives the login round-trip
 * via the persisted Zustand store.
 */

const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] }, guardMode: "strict" });

test("guest reaches the step-4 auth gate and state survives sign-in", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/booking");
  await expect(page).toHaveURL(/step=1/);

  // Step 1 — dates + category (calendar day buttons, Radix combobox).
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const month = d.toLocaleString("en-AU", { month: "long" });
    return new RegExp(`${month} ${d.getDate()}(st|nd|rd|th), ${d.getFullYear()}`);
  };
  await page.getByRole("button", { name: day(15) }).first().click();
  await page.getByRole("button", { name: day(17) }).first().click();
  await page.getByRole("combobox").last().click();
  await page.getByRole("option").first().click();
  await page.locator("main").getByRole("button", { name: /^continue$/i }).click();
  await expect(page).toHaveURL(/step=2/);

  // Step 2 → 3 → 4.
  await page.getByRole("button", { name: /no preference/i }).click();
  await page.locator("main").getByRole("button", { name: /^continue$/i }).click();
  await expect(page).toHaveURL(/step=3/);
  await page.locator("main").getByRole("button", { name: /^continue$/i }).click();
  await expect(page).toHaveURL(/step=4/);

  // Auth gate (inline-auth flag off): sign-in + create-account links.
  const signIn = page.locator("main").getByRole("link", { name: /sign in/i });
  await expect(signIn).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: /create account/i })).toBeVisible();

  // Sign in as the seeded customer; wizard state must survive the round-trip.
  await signIn.click();
  await page.locator('input[type="email"]').fill("sarah.smith@example.com");
  await page.locator('input[type="password"]').fill("customer1234");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20_000 });

  // Note: callbackUrl is currently ignored for credentials login (finding #5)
  // — navigate back manually, as a real customer would have to.
  await page.goto("/booking");
  await expect(page).toHaveURL(/step=4/);
  await expect(page.locator("main")).toContainText(/review your details|your details/i);
});
