import type { Page } from "@playwright/test";
import { totpNow } from "./totp";

/**
 * Drive the two-step email/password login form. Submits email + password, and
 * if the form reveals the TOTP step (`auth.preauth` returned `need_totp` for a
 * back-office user), fills a freshly generated code from the seeded e2e secret
 * and submits again. Waits until the URL leaves /login.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
  opts: { expectedUrl?: RegExp; totpSecret?: string } = {},
): Promise<void> {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  const totpInput = page.locator("#totpCode");
  // The second step is gated client-side behind a preauth round-trip; give it a
  // moment to appear. If it never does, this account has no TOTP — carry on.
  try {
    await totpInput.waitFor({ state: "visible", timeout: 5_000 });
    await totpInput.fill(totpNow(opts.totpSecret));
    await page.getByRole("button", { name: /verify and sign in|verify/i }).click();
  } catch {
    // No TOTP step — credentials-only account (e.g. seeded customers).
  }

  await page.waitForURL(opts.expectedUrl ?? /^(?!.*\/login).*$/, { timeout: 20_000 });
}
