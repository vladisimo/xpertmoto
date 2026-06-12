import { test, expect } from "./_fixtures/test";
import { e2ePrisma } from "./_fixtures/db";

/**
 * Forgot/reset password end-to-end without an inbox: the reset token is
 * stored RAW in VerificationToken (identifier "password-reset:<email>"), so
 * the spec reads it from the e2e DB instead of scraping email. Runs as
 * qa.customer — sarah's password is baked into the auth.setup storage state
 * and must not change mid-suite.
 *
 * Runs in the public project (unauthenticated start).
 */

const EMAIL = "qa.customer@example.com";
const NEW_PASSWORD = "E2eReset!2026x";

// The final stage EXPECTS auth.resetPassword to 400 (token reuse must be
// rejected) — strict mode would flag that expected error, and test.use()
// can't extend the array-valued allowlist. Run guard-off and assert
// explicitly at the end.
test.use({ guardMode: "off" });

test("forgot password → emailed token resets the password → old token rejected", async ({
  page,
  browserIssues,
}) => {
  test.setTimeout(120_000);

  await page.goto("/forgot-password");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.getByRole("button", { name: /send|reset|email/i }).first().click();
  await expect(page.getByText(/sent|check your (inbox|email)|if an account/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // The raw token is in the DB (and was emailed via Mailpit).
  let token = "";
  await expect
    .poll(
      async () => {
        const row = await e2ePrisma.verificationToken.findFirst({
          where: { identifier: `password-reset:${EMAIL}` },
          select: { token: true },
        });
        token = row?.token ?? "";
        return token.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  const pwInputs = page.locator('input[type="password"]');
  const pwCount = await pwInputs.count();
  for (let i = 0; i < pwCount; i++) {
    await pwInputs.nth(i).fill(NEW_PASSWORD);
  }
  await page.getByRole("button", { name: /reset|save|set password|update/i }).first().click();
  await expect(page.getByText(/success|updated|sign in|reset/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // New password signs in.
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(NEW_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20_000 });

  // Token is single-use: a second visit must not offer a working reset.
  await page.context().clearCookies();
  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  const reused = page.locator('input[type="password"]');
  if ((await reused.count()) > 0) {
    await reused.first().fill("AnotherPass!123");
    if ((await reused.count()) > 1) await reused.nth(1).fill("AnotherPass!123");
    await page.getByRole("button", { name: /reset|save|set password|update/i }).first().click();
    await expect(page.getByText(/invalid|expired|error/i).first()).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(page.getByText(/invalid|expired/i).first()).toBeVisible();
  }

  // Guard ran in "off" mode — apply it manually, allowing only the expected
  // token-reuse rejection.
  const { filterIssues, DEFAULT_ALLOWLIST } = await import("./_fixtures/browser-guard");
  const unexpected = filterIssues(browserIssues, [
    ...DEFAULT_ALLOWLIST,
    { pattern: /auth\.resetPassword/ },
  ]);
  expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
});
