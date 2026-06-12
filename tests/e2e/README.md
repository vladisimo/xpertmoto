# E2E suite — conventions (June 2026 overhaul)

Run everything: `npm run db:reset:e2e && npm run test:e2e:local`.
Real-Stripe tier: export `STRIPE_TEST_SECRET_KEY` + `STRIPE_TEST_PUBLISHABLE_KEY`,
then `npm run test:e2e:stripe`.

## Hard rules

1. **Import `test`/`expect` from `tests/e2e/_fixtures/test.ts`** — never from
   `@playwright/test` directly (exception: `auth.setup.ts`). The merged test
   wires the browser-issue guard onto every page: console errors, uncaught
   exceptions, failed same-origin requests, and same-origin HTTP ≥ 400 are
   captured per test. `guardMode: "strict"` (set per file via `test.use`)
   fails the test on any non-allowlisted issue; `"report"` (default) attaches
   them to the report. The allowlist lives in `_fixtures/browser-guard.ts` —
   third-party noise only; never allowlist a same-origin `/api/trpc` 5xx.
   NOTE: Playwright's `test.use()` cannot override array-valued fixture
   options (`guardAllow`) — run `guardMode: "off"` and call `filterIssues`
   explicitly when a test expects a specific error.
2. **Direct DB access goes through `_fixtures/db.ts` (`e2ePrisma`)** —
   importing `src/lib/prisma` from a spec binds to the DEV database (the
   Playwright process doesn't load `.env.e2e`) and is banned.
3. **Mutating specs create their own data via `_fixtures/factory.ts`** —
   never mutate seeded `QA-*` fixtures or seeded bookings; they're shared and
   one-shot. Read-only assertions on seed data are fine. Give each factory
   call in a spec file a distinct `slot` so parallel workers don't contend
   for the same date window (single depot allocation lock; all stock is in
   one category). **Sarah's PROFILE is shared mutable state**: wizard step-4
   edit mode saves to it, so parallel specs can rewrite phone/identity
   fields between your write and your assertion — assert profile mutations
   against the DB (`e2ePrisma`) right after saving, not via a later reload,
   and `createConfirmedBooking` reasserts her seeded passport (class-C LAMS
   eligibility rides on it).
4. **Route inventory lives in `_manifest/routes.ts`** and derives from
   `src/lib/nav.ts` — new nav items are swept automatically. Routes with
   confirmed open bugs go in `KNOWN_BUG_ROUTES` (rendered as `test.fixme`
   with the finding reference) — remove the entry when the bug is fixed.

## Environment

The e2e stack is fully isolated (see `.env.e2e`): `xpertmoto_e2e` DB,
Redis DB 3, `.next-e2e` dist dir, port 3137, **stub Stripe** (vars blanked),
**Mailpit** capture on :1027/:8027 (`xpertmoto-e2e-mailpit` container —
1025/6 are taken by other projects), `AUTH_URL`/`APP_URL` pointing at 3137,
and `LOADTEST_RATELIMIT_OFF=1` (localhost-only kill-switch; without it the
`auth:preauth` IP bucket 429s the auth.setup project on repeat runs).

Seeded logins: `sarah.smith@example.com`/customer1234 (onboarded customer),
`qa.customer@example.com` (use for password-mutation specs — sarah's
password is baked into the auth.setup storage state),
`staff.lewisham@…`/staff1234, `manager.lewisham@…`/staff1234,
`admin@xpertmoto.com.au`/admin1234 (SUPER_ADMIN). Back-office users carry
the deterministic TOTP secret (`_fixtures/totp.ts`).

Findings from this suite are tracked in
[docs/frontend-test-findings.md](../../docs/frontend-test-findings.md).
