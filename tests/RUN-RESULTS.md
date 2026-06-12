# Scenario Suite — Run Results

Run against `launch-prep` at `/home/vlad/scootering` on 2026-06-13, as part of
the comprehensive front-end test effort (browser-error guard + per-role route
sweeps + interactive flow specs). Environment: isolated e2e stack — Postgres
`xpertmoto_e2e`, Redis DB 3, `.next-e2e`, port 3137, **stub Stripe**, dedicated
Mailpit on :1027/:8027. See `tests/e2e/README.md` for conventions and
`docs/frontend-test-findings.md` for every bug found in the effort
(6 fixed in-branch, the rest triaged open/noted).

Previous run for comparison: 2026-04-18 on `main` — 12 e2e passed / 5 failed
("pre-existing environmental" failures, since root-caused: legacy specs'
local login helpers predated mandatory back-office TOTP and had never
actually signed in).

---

## Summary

| Step | Command | Outcome |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ clean |
| Lint | `npx eslint` over all changed files | ✅ clean |
| Vitest | `npm run test` | ✅ **3,951 passed / 18 skipped** (465 files) — incl. new `isCustomerComplete` legacy-path cases and the `live.heartbeat` create-race fallback test |
| Playwright E2E (full, clean-room) | `npm run test:e2e:local` | ✅ **237 passed / 0 failed / 11 skipped** in 5.1 min (4 workers, fresh reseed, fresh server) |

The 11 skips are deliberate: real-Stripe specs (`STRIPE_READY` guard — run
locally via `npm run test:e2e:stripe`), the two `KNOWN_BUG_ROUTES` fixmes
(STAFF campaigns/segments 403 — finding #13), data-conditional skips
(swap-wizard full path), and placeholder shells awaiting deeper DOM work
(check-in-damage).

## What the suite now covers

- **Browser-error guard on every spec** (`tests/e2e/_fixtures/browser-guard.ts`):
  console errors, uncaught page exceptions, failed same-origin requests and
  same-origin HTTP ≥ 400 fail strict-mode tests; API errors attach their
  request/response payloads to the report. This is the passive dead-button /
  broken-sequence detector — it found the analytics beacon bug (#17) and the
  heartbeat create-race 500 (#24) without any targeted assertion.
- **Per-role route sweeps** (~165 routes): every public, customer, staff
  (role STAFF) and admin (SUPER_ADMIN) page incl. all `?tab=` deep links and
  representative `[id]` pages, asserted to render with zero non-allowlisted
  browser issues. Manifest derives from `src/lib/nav.ts`, so new nav items
  are swept automatically. Plus tab-control crawls, sidebar-flyout crawl,
  and a public link-integrity sweep.
- **Booking funnel**: full 6-step wizard end-to-end in stub mode (guest auth
  gate, `?step` URL sync, reload persistence, back button, consent
  checkboxes, confirmation + portal visibility); real-card happy/decline/3DS
  specs behind the Stripe tier.
- **Staff lifecycle**: factory booking → pre-hire inspection → check-out
  verify (UI) → agreement signing (the same tRPC chain the tablet pad
  calls) → handover (UI) → ACTIVE → StatusActions return + complete →
  COMPLETED with the vehicle back to AVAILABLE.
- **Back-office flows**: walk-in POS modal end-to-end, pricing discount CRUD
  verified against the public quote engine, invoice void (prompt/confirm
  dialogs), Linkt CSV import → unmatched queue, admin branding round-trip,
  fleet CTP document upload (DB-asserted), damage-map marker placement,
  staff priority tasks.
- **Auth**: customer/staff/admin UI logins with TOTP (in-page step AND the
  `/verify-2fa-step-up` redirect variant, clock-edge retry), dual-access
  portal-select (incl. its self-forwarding), forgot/reset password
  end-to-end with token-reuse rejection, anonymous redirect contracts.
- **Devices**: iPhone 14 wizard + bottom tab bar; iPad check-out
  (chromium-engined emulation — host lacks WebKit system libraries).
- **Email**: booking confirmation captured by Mailpit; zero real outbound
  mail from e2e runs (previously they relayed real email).

## Coverage gaps that remain

- Magic-link end-to-end (NextAuth hashes the token; needs a Mailpit-driven
  spec — `E2E_MAILPIT_API` is already plumbed).
- TOTP enrolment UI and email/phone verification (SCENARIOS A10 remainder).
- Real-Stripe webhook-driven paths (needs `stripe listen`; manual/local).
- Tablet signature-pad canvas drawing inside the agreement flow (the
  lifecycle spec signs via tRPC; canvas interaction is covered by
  damage-map.spec).
- Check-in damage → assess → settle through the UI (lifecycle uses the
  no-damage StatusActions path; `check-in-damage.spec.ts` remains a shell).
