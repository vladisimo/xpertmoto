# Front-end test findings — launch-prep (June 2026)

Exploratory pass + Playwright suite findings against the isolated e2e stack
(port 3137, stub Stripe, Mailpit email capture). Status values:
`fixed` (in this branch), `open` (needs decision/larger work), `noise`
(allowlisted, not a product bug).

**Fixed in this effort (5):** #4 wizard step-4 dead-end for legacy
`licenceType=null` profiles (high — blocked the whole booking funnel),
#17 sendBeacon analytics exit-flush never worked (medium), #21 five legacy
e2e specs' TOTP-less logins silently failing since 2FA enforcement (medium,
test-infra), #14 template preview iframe raw-template flash/ORB (low),
#11 e2e env sent real email / used real Stripe (test-infra).

**Open, needs decision (highest first):** #13 STAFF sees broken
Campaigns/Segments pages (nav/procedure role mismatch), #5 login ignores
`callbackUrl` (booking-funnel friction), #1 anonymous `whoAmI`/`customer.me`
401 probes on every public page view, #19/#20 silent wizard-step clamps,
#6 duplicate `<main>` landmark after route-group navigation, #7/#10 React
controlled/uncontrolled warnings, #8 misleading category-capacity fallback,
#18 `role=tab` without `tabpanel` on URL-driven tab bars, #2 favicon 404
(set `branding.faviconUrl`), Sentry tunnel `/monitoring` 500s when upstream
unreachable (should degrade gracefully).

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| 1 | low | public/all pages | Anonymous visitors fire `session.whoAmI` which responds **401** on every public page view — console error + wasted request for every logged-out visitor. Should return `null` for anonymous sessions or not be called without a session. | investigating |
| 2 | low | public | `/favicon.ico` 404s — no fallback favicon at the root path (browsers request it unconditionally). | investigating |
| 3 | noise | public | PostHog `config.js` 404s — the `phx_…` project key appears invalid/placeholder in dev; third-party, allowlisted in the e2e guard. | noted |
| 4 | **high** | booking wizard | **Returning customers with `licenceType=null` profiles were silently hard-stuck at step 4.** `isCustomerComplete()` required `identityPath`, but legacy profiles (saved before `licenceType` existed, and the entire `wizard_intl_licence_flow=off` rollout) never set it — `w.next()` clamped back to step 4 with zero feedback in both review and edit modes (Continue appeared dead; "Save & continue" appeared to succeed then did nothing). Fixed: null `identityPath` now falls back to the validator's documented legacy rule (licence triplet OR passport triplet) in [src/stores/booking-wizard.ts](../src/stores/booking-wizard.ts); unit test updated (it had codified the bug). Verified in-browser: full wizard now completes end-to-end. | **fixed** |
| 5 | low | booking funnel | `/login?callbackUrl=/booking` ignores the callbackUrl for credentials login — a customer who signs in mid-booking lands on `/dashboard` instead of returning to the wizard (state survives, but they must navigate back manually). | open |
| 6 | low | a11y | After client-side nav between route groups (e.g. /booking → /login), the previous route group's `<main>` stays mounted at 0×0 — two `main` landmarks in the DOM (WCAG: one main landmark per page). Likely App Router layout-persistence artifact; needs a hard-nav comparison. | open |
| 7 | low | booking wizard | React "Select is changing from uncontrolled to controlled" warning when picking dates enables the pickup/return time selects (step 1). Controlled/uncontrolled switch in the time `Select`s. | open |
| 8 | low | fleet/booking UI | Vehicle cards and confirmation specs show the **category** engine capacity when `VehicleModel.engineCapacityCc` is null (e.g. "660cc" on a 50cc Honda Dio). Real model data mostly avoids it, but the fallback is misleading — prefer hiding the spec when model capacity is unknown. (Seed also leaves `engineCapacityCc` null for all models.) | open |
| 9 | info | wizard guest path | Step 4 for guests shows "Sign in to continue" links (the `wizard_inline_auth` flag is off in seed), not the InlineAuthPanel. Guest funnel = login round-trip; wizard state survives via localStorage. | noted |
| 10 | low | /admin/platform | React error "A component is changing an uncontrolled input to be controlled" on first render of /admin/platform — an input mounts with `value=undefined` then receives data. | open |
| 11 | info | e2e env | The e2e server previously ran **real test-mode Stripe** and sent **real outbound email** via the `.env` SMTP relay (e2e bookings emailed @example.com addresses through mail.snip-snip.org). Fixed in `.env.e2e`: Stripe vars blanked (stub mode), SMTP → dedicated Mailpit on :1027/:8027, AUTH_URL/APP_URL → localhost:3137. Verified: booking-confirmation email captured by Mailpit. | **fixed** |
| 12 | info | e2e seed | Only the LAMS category has seeded vehicles (29) — Unrestricted/Utility have 0, so the wizard correctly shows one category. Some seeded bookings pair a category with a vehicle from another category (fallback pool). Factory bookings must spread across date windows, not categories. | noted |
| 13 | **medium** | staff/communications | **Nav/role mismatch: STAFF users get broken Campaigns and Segments pages.** `BACK_OFFICE_NAV` exposes Communications children to STAFF_PLUS, but `communication.campaignList` and `communication.segmentList` are `managerProcedure` → the pages render then their data queries 403. Needs a product decision: per-child `allowedRoles` in nav.ts, or relax the procedures, or an in-page "requires manager" state. Tracked as `test.fixme` in the staff route sweep (`KNOWN_BUG_ROUTES`). | open |
| 14 | low | staff/communications | Template email preview iframe rendered the **raw** template while the server-side preview query was in flight — literal `{{logoUrl}}` became a relative URL inside the srcdoc, fired a junk request through the auth middleware and got ORB-blocked (flash of unsubstituted template). Fixed: [body-editor.tsx](../src/components/communications/body-editor.tsx) now shows the skeleton until the preview resolves. | **fixed** |
| 15 | info | e2e env | Repeated suite runs from one host trip the `auth:preauth` IP rate limit (429) and kill the auth.setup project. Fixed via the existing localhost-only `LOADTEST_RATELIMIT_OFF=1` kill-switch in `.env.e2e` (honoured only when APP_URL is localhost). | **fixed** |
| 16 | low | back-office UX | Server-redirect stub routes (`/staff/incidents`, `/staff/inspections`, `/staff/maintenance`, `/staff/tolls`, `/admin/backups`, etc. → `?tab=` URLs) work but stream a bare "Loading" shell first; harmless, noted for sweep timing. | noted |
| 17 | **medium** | analytics | **The `navigator.sendBeacon` exit-flush in `use-visitor-events.ts` has never worked**: it POSTed a bare `{ events }` body to `/api/trpc/live.events` (no tRPC transformer envelope, no `?batch=1`), so the server 400s every beacon — the exit-flush batch (EXIT_INTENT, final wizard-step events, anything queued at page-hide/unload) is silently dropped in production. Found by the wizard-stub spec's strict guard (the 400 fires on `/booking/confirmation` at page close); confirmed via server logs — the failing POST is the only one without `?batch=1`. Fixed: beacon body now wraps the input in the `{ json: … }` envelope ([use-visitor-events.ts](../src/hooks/use-visitor-events.ts)). Covered by the wizard-stub e2e (strict guard would re-flag a regression). Also noted: `sanitizeEvent` clamps `target`/`value` but passes `metadata` through unclamped while the server caps metadata strings at 500 chars — any future metadata-bearing event could poison a whole batch (no current emitter sends metadata). | **fixed** |
| 18 | low | a11y | URL-driven tab bars (e.g. `/admin/dashboard`, AdminDashboardTabsBar) render Radix `TabsTrigger`s (`role=tab`) with no corresponding `tabpanel` — `aria-controls` points at nothing. Real Radix `TabsContent` pages are fine. | open |
| 19 | low | booking wizard | One-frame hydration race at step 4: the review UI paints before the store-hydration effect runs, so a click on Continue in that frame is a silent no-op. Imperceptible to humans (POM retries cover the suite), but the same silent-clamp pattern as finding #4 — `handleContinue` should surface *why* it can't advance instead of doing nothing. | open |
| 20 | info | wizard step 2 | Continue on step 2 without choosing a vehicle or "No preference" is also a silent no-op (same `maxReachableStep` clamp family as #4/#19). | open |
| 21 | **medium** | auth (pre-existing) | **Five legacy e2e specs carried local `login()` helpers that predate mandatory back-office TOTP** — they filled email+password only, never the 2FA step, so every staff/admin UI-login spec has silently failed since TOTP enforcement landed (the "5 pre-existing environmental failures" in the old RUN-RESULTS). All migrated to the shared `_fixtures/login.ts` (which now handles the in-page TOTP step, the `/verify-2fa-step-up` redirect variant, and clock-edge retry) and their drifted selectors updated (settings tabs are `role=tab`; strict-mode duplicates; portal-select click-through for dual-access users). | **fixed** |
| 22 | low | customer profile | `customer.updateProfile` treats `passportNumber: ""` as "delete my passport" — combined with any form variant that submits an empty passport field, a routine profile save can silently destroy verified identity data (observed in-suite: sarah's passport wiped → LAMS booking eligibility immediately broken, since class-C licences rely on passport-only ID). Consider requiring an explicit clear flag instead of empty-string semantics. | open |
| 23 | info | walk-in POS | The walk-in sheet's default pickup time falls outside depot hours, so the submit starts disabled with a validation message — staff must set times before the vehicle pick is usable. Works as designed but is extra friction on every walk-in; consider defaulting to the next open slot. | open |
| 24 | **medium** | analytics | **Concurrent first-heartbeats for a new visitor 500'd** — `live.heartbeat` did find-then-create; parallel heartbeats (layout + page components fire together on first load) raced the create and the losers hit the `VisitorSession.id` unique constraint → HTTP 500 on every fresh visitor's first page view. Reproduced deterministically (5 of 6 parallel first-heartbeats 500). Fixed: the create now catches P2002 and downgrades to a touch update ([live.ts](../src/server/trpc/router/live.ts)); unit-tested in `tests/unit/trpc/router/live.test.ts`. | **fixed** |

## Exploratory pass coverage (2026-06-12, e2e stack :3137)

Hand-driven with the Playwright MCP browser, console + network captured per stop:
home, /fleet, /fleet/[slug], /locations, full booking wizard steps 1–6 (guest →
auth gate → sign-in → stub payment → confirmation, ref SCT-20260612-WA3N28),
customer portal (dashboard, bookings list + detail incl. GST display check
220.97/11=20.09 ✓, pay, documents, support), staff portal (TOTP login,
portal-select, dashboard, tasks, calendar, booking detail QA-CONFIRMED + 5 tabs,
check-out landing + sign step, customers, fleet), admin portal (dashboard,
finance/invoices, pricing, settings, integrations, audit-log, reports,
platform). Mobile layout (390px) covered for the entire customer flow; desktop
(1440px) for back-office.
