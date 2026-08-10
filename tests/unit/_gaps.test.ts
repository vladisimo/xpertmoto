import { test } from "vitest";

/**
 * Scenario coverage gaps — features not yet implemented. Each stub below
 * corresponds to a row in the "Gaps" section of `tests/SCENARIOS.md`.
 *
 * The intent is to make missing coverage visible in every `npm test` run
 * (vitest reports skipped tests in the summary). When a feature lands:
 *   1. Delete the corresponding `test.skip` below.
 *   2. Author a real test in the relevant module file.
 *   3. Move the Gaps row in SCENARIOS.md into the appropriate module table.
 *
 * ---------------------------------------------------------------------
 * Reconciliation, 2026-08-11 (NT-016)
 *
 * The original list carried 9 stubs from an earlier audit. Five of those
 * features have since shipped, so their stubs are gone — a skipped stub
 * for working code is worse than no stub, it reports a permanent false
 * "missing" in every test run. Recorded here so the audit trail survives
 * the deletion:
 *
 *   old GAP 1  Password reset flow — SHIPPED. `auth.requestPasswordReset`
 *              + `auth.resetPassword` (src/server/trpc/router/auth.ts),
 *              UI at src/app/(auth)/forgot-password + /reset-password.
 *              Tested: tests/unit/trpc/router/auth.test.ts
 *              ("auth.requestPasswordReset", "auth.resetPassword").
 *   old GAP 2  Magic-link sign-in — SHIPPED. NextAuth Nodemailer provider
 *              (src/lib/auth.ts) + emails/magic-link.tsx + the
 *              /magic-link-sent page. Tested: tests/unit/lib/auth-signin.test.ts
 *              ("evaluateSignIn — nodemailer" — active-user gate,
 *              soft-delete and non-ACTIVE rejection).
 *   old GAP 3  Email verification — SHIPPED as QA Round-2 M4 (grandfather
 *              -everyone via scripts/backfill-email-verified.ts, then
 *              enforced for new accounts). Tested:
 *              tests/unit/trpc/router/auth.test.ts ("auth.register — email
 *              verification (R2-M4)", "auth.verifyEmail",
 *              "auth.resendVerification").
 *   old GAP 5  Staff 2FA / TOTP — SHIPPED. src/server/trpc/router/totp.ts,
 *              enrolment at src/app/(onboarding)/totp, step-up gate in
 *              src/lib/auth-step-up.ts. Tested: tests/unit/lib/totp.test.ts,
 *              tests/unit/lib/auth-step-up-token.test.ts,
 *              tests/unit/trpc/router/auth-step-up.test.ts, and TOTP logins
 *              in tests/e2e/_fixtures/totp.ts.
 *   old GAP 6  Login rate-limiting — SHIPPED. `auth:preauth` bucket at
 *              10 attempts / 15 min with the LOADTEST_RATELIMIT_OFF
 *              kill-switch. Tested: tests/unit/lib/rate-limit.test.ts
 *              (limiter + kill-switch) and tests/unit/trpc/router/auth.test.ts
 *              ("auth.preauth — login rate limiting" — bucket wiring and the
 *              TOO_MANY_REQUESTS response).
 *
 * The four stubs below are the genuinely-open gaps, renumbered 1–4
 * (formerly 4, 7, 8, 9). SCENARIOS.md uses the new numbering.
 */

test.skip("GAP 1 — phone verification gates booking check-out", () => {
  // `User.phoneVerified` exists in prisma/schema.prisma and is cleared by
  // src/server/services/anonymise-user.ts, but nothing ever sets it: there
  // is no send-code / confirm-code flow and no check-out gate reading it.
});

test.skip("GAP 2 — session revocation endpoint", () => {
  // Still JWT-expiry only — no admin-side "force logout". Would need a
  // per-user token epoch compared in the src/lib/auth.ts jwt callback so
  // already-issued JWTs stop validating.
});

test.skip("GAP 3 — PHONE / AGENT booking source", () => {
  // `BookingSource.PHONE` / `.AGENT` exist in prisma/schema.prisma but no
  // code path writes either value; staff bookings are all WALK_IN. Needs a
  // staff procedure that records the source distinctly from walk-in.
});

test.skip("GAP 4 — inter-depot transfer order workflow", () => {
  // Post-return relocation works, but there is no TransferOrder model,
  // scheduler, or completion step that flips `vehicle.depotId`.
});
