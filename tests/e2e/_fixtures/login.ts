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

  // Two outcomes from the credentials submit: credentials-only accounts
  // navigate away from /login; TOTP-enrolled back-office accounts reveal the
  // #totpCode step (after an auth.preauth round-trip that can take >5s on a
  // cold dev server — don't time this out tightly, and never swallow a
  // missing TOTP step silently: a back-office login stuck on the 2FA form
  // used to "pass" the fixture and fail the spec with a confusing assertion).
  // 60s: the very first cold hit pays for compiling /login, auth.preauth,
  // and whatever routes the parallel setup workers are forcing at the same
  // time — 20s starves out on a cold `next dev`.
  const totpInput = page.locator("#totpCode");
  const outcome = await Promise.race([
    totpInput
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "totp" as const)
      .catch(() => "none" as const),
    page
      .waitForURL(/^(?!.*\/login).*$/, { timeout: 60_000 })
      .then(() => "navigated" as const)
      .catch(() => "none" as const),
  ]);
  if (outcome === "none") {
    throw new Error(
      `login(${email}): credentials submit produced neither a TOTP step nor a navigation within 60s (still at ${page.url()})`,
    );
  }
  // The TOTP challenge appears either as the login form's in-page second step
  // OR as a redirect to /verify-2fa-step-up (pending2fa session) — both render
  // #totpCode. Submit with Enter (like a human) and retry once with a fresh
  // code — a code generated at second 29 of its window can expire in flight.
  if (outcome === "totp" || /verify-2fa-step-up/.test(page.url())) {
    await totpInput.waitFor({ state: "visible", timeout: 10_000 });
    for (let attempt = 0; attempt < 2; attempt++) {
      await totpInput.fill(totpNow(opts.totpSecret));
      await totpInput.press("Enter");
      const left = await page
        .waitForURL((u) => !/\/(login|verify-2fa-step-up)(\?|$)/.test(new URL(u).pathname), {
          timeout: 8_000,
        })
        .then(() => true)
        .catch(() => false);
      if (left) break;
      if (attempt === 1) {
        throw new Error(
          `login(${email}): TOTP verification did not leave the 2FA step after 2 attempts (at ${page.url()})`,
        );
      }
    }
  }

  await page.waitForURL(opts.expectedUrl ?? /^(?!.*\/login).*$/, { timeout: 20_000 });
}
