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
 */

test.skip("GAP 1 — password reset flow (no endpoint exists in auth router)", () => {
  // TODO: implement `reset: publicProcedure` in src/server/trpc/router/auth.ts
});

test.skip("GAP 2 — magic link sign-in provider", () => {
  // TODO: add NextAuth EmailProvider in src/lib/auth.ts
});

test.skip("GAP 3 — email verification gates login", () => {
  // TODO: check emailVerified in authorize() + add verification endpoint
});

test.skip("GAP 4 — phone verification gates booking check-out", () => {
  // TODO: enforce phoneVerified when staff setting requires it
});

test.skip("GAP 5 — staff 2FA (TOTP)", () => {
  // TODO: schema fields + enrolment flow + authorize() check
});

test.skip("GAP 6 — login rate-limiting (10 attempts / 15 min)", () => {
  // TODO: Redis-backed counter in NextAuth authorize()
});

test.skip("GAP 7 — session revocation endpoint", () => {
  // TODO: admin-side 'force logout' that invalidates JWTs via rotation
});

test.skip("GAP 8 — PHONE / AGENT booking source", () => {
  // TODO: dedicated staff procedure distinct from walk-in
});

test.skip("GAP 9 — inter-depot transfer order workflow", () => {
  // TODO: TransferOrder model + scheduler + completion flips vehicle.depotId
});
