# XPERT Moto — Scenario Coverage Matrix

Every user, operator, and system scenario in the platform, mapped to the test
that covers it. Derived from the plan at
`.claude/plans/build-every-scenario-for-humble-brook.md`.

Legend:
- **Covered** — a passing test already exercises this scenario. File reference given.
- **New** — added in the same change as this document. File reference given.
- **GAP** — implementation missing; see the gaps list at the bottom.

---

## A. Auth & user account

| # | Scenario | Status | Reference |
|---|---|---|---|
| A1 | Register — valid customer | Covered | `tests/e2e/auth-and-portal.spec.ts` |
| A2 | Register — schema rejects short password / bad email / blank names | New | `tests/unit/trpc/router/auth-schema.test.ts` |
| A3 | Register — DOB coerced to Date, marketingOptIn defaults false, empty phone normalises | New | `tests/unit/trpc/router/auth-schema.test.ts` |
| A4 | Eligibility — underage, missing licence, expired licence, wrong class | Covered | `tests/unit/eligibility.test.ts` |
| A5 | Login — credentials success | Covered | `tests/e2e/auth-and-portal.spec.ts` |
| A5a | Login schema — rejects empty password, malformed email | New | `tests/unit/trpc/router/auth-schema.test.ts` |
| A6 | Licence verification workflow | Covered | `tests/unit/trpc/router/staff-customer.test.ts` |
| A7 | Licence expiry reminders (30/14/7 day windows) | Implemented, not unit-tested | `src/server/jobs/licence-expiry.ts` — job hits prisma directly; would need a DB integration test |
| A8 | Suspended / banned user gated from sending notifications | Covered | `tests/unit/consent.test.ts` |
| A9 | Role-based route protection (customer→staff, staff→admin) | Covered | Per-role route sweeps (`tests/e2e/{public,customer,staff,admin}/route-sweep.spec.ts`) assert no auth bounce + content mounts for ~165 routes per role |
| A10 | Password reset (request → token → reset → reuse rejected) | Covered (e2e) | `tests/e2e/password-reset.spec.ts` — token read from VerificationToken; magic link / email-phone verify / 2FA-enrol UI remain GAP (`tests/unit/_gaps.test.ts`) |

## B. Public booking wizard (customer)

| # | Scenario | Status | Reference |
|---|---|---|---|
| B1 | Quote — base × duration + GST | Covered | `tests/unit/pricing.test.ts` |
| B2 | Quote — weekly rate + 10% discount at 7 days | Covered | `tests/unit/pricing.test.ts` |
| B3 | Quote — season multiplier (1.5× Christmas) | Covered | `tests/unit/pricing.test.ts` |
| B4 | Quote — addons and insurance line items | Covered | `tests/unit/pricing.test.ts` |
| B5 | Quote — percentage discount code | Covered | `tests/unit/pricing.test.ts` |
| B6 | Quote — same-depot pickup/return → no one-way fee | Covered | `tests/unit/pricing.test.ts` |
| B7 | Quote — one-way fee applied for allowed depot pair | Covered | `tests/unit/pricing.test.ts` |
| B8 | Quote — one-way disallowed pair throws `OneWayDisallowedError` | Covered | `tests/unit/pricing.test.ts` |
| B9 | Quote — depot pair with no `OneWayFee` row is allowed (zero fee) | Covered | `tests/unit/pricing.test.ts` |
| B10 | Booking wizard → payment → confirmation (E2E) | Covered | `tests/e2e/booking-payment.spec.ts` |
| B11 | Agreement terms version snapshot | Covered | `tests/unit/lib/agreement/terms.test.ts` |
| B12 | Agreement timestamp captured at signature | Covered | `tests/unit/lib/agreement/timestamp.test.ts` |
| B13 | Insurance upsell at booking time | Covered | `tests/unit/trpc/router/booking-insurance-upsell.test.ts` |
| B14 | Cart recovery job for abandoned carts | Covered | `tests/unit/jobs/cart-recovery.test.ts` |

## C. Walk-in / POS (staff)

| # | Scenario | Status | Reference |
|---|---|---|---|
| C1 | Walk-in booking (staff `createWalkIn`) | Implemented, not unit-tested | `src/server/trpc/router/staff-booking.ts:1728` — no pure helper extracted; needs integration test with DB |
| C2 | Walk-in flow end-to-end via staff tasks queue | Covered (indirect) | `tests/e2e/staff-tasks.spec.ts` |

## D. Pricing cascade

| # | Scenario | Status | Reference |
|---|---|---|---|
| D1 | Duration rounding — min 1, rounds up partial days | Covered | `tests/unit/pricing.test.ts` |
| D2 | Yield pricing — demand-responsive multiplier | Covered | `tests/unit/services/yield-pricing.test.ts` |
| D3 | Revenue aggregator — totals by depot, category, period | Covered | `tests/unit/services/revenue-aggregator.test.ts` |
| D4 | Telematics-based revenue adjustments | Covered | `tests/unit/services/telematics-revenue.test.ts` |
| D5 | Money primitives — Decimal rounding, cents, currency display | Covered | `tests/unit/lib/money.test.ts` |
| D6 | Depreciation — straight-line + diminishing-value | Covered | `tests/depreciation.test.ts` |

## E. Availability engine

| # | Scenario | Status | Reference |
|---|---|---|---|
| E1 | No bookings → vehicle free | Covered | `tests/unit/availability.test.ts` |
| E2 | Overlapping booking blocks vehicle | Covered | `tests/unit/availability.test.ts` |
| E3 | 2-hour buffer between bookings enforced | Covered | `tests/unit/availability.test.ts` |
| E4 | 3-hour gap clears buffer | Covered | `tests/unit/availability.test.ts` |
| E5 | `countAvailable` excludes conflicting vehicles | Covered | `tests/unit/availability.test.ts` |
| E6 | Open work-order blocks availability | Covered | `tests/unit/availability.test.ts` |
| E7 | Non-overlapping work order doesn't block | Covered | `tests/unit/availability.test.ts` |
| E8 | Completed work order doesn't block | Covered | `tests/unit/availability.test.ts` |
| E9 | `allocateVehicle` picks lowest-odometer free vehicle | Covered | `tests/unit/availability.test.ts` |
| E10 | Booking exclusion-constraint violation identified | Covered | `tests/unit/availability.test.ts` |

## F. Check-out workflow (staff)

| # | Scenario | Status | Reference |
|---|---|---|---|
| F1 | Assignment preconditions — rejects wrong status | Covered | `tests/unit/trpc/router/staff-booking-assign.test.ts` |
| F2 | Assignment preconditions — rejects when vehicle already assigned | Covered | `tests/unit/trpc/router/staff-booking-assign.test.ts` |
| F3 | Manual vehicle choice — rejects non-AVAILABLE | Covered | `tests/unit/trpc/router/staff-booking-assign.test.ts` |
| F4 | Manual vehicle choice — rejects inactive vehicle | Covered | `tests/unit/trpc/router/staff-booking-assign.test.ts` |
| F5 | Manual vehicle choice — rejects different category | Covered | `tests/unit/trpc/router/staff-booking-assign.test.ts` |
| F6 | Manual vehicle choice — rejects different depot | Covered | `tests/unit/trpc/router/staff-booking-assign.test.ts` |
| F7 | Check-out staff task auto-collection | Covered | `tests/unit/services/task-collectors/bookings.test.ts` |
| F8 | Pre-hire inspection completion gate | Covered | `tests/unit/services/task-collectors/inspections.test.ts` |
| F9 | Rental agreement signed gate | Covered | `tests/unit/services/task-collectors/agreements.test.ts` |

## G. Check-in workflow (staff)

| # | Scenario | Status | Reference |
|---|---|---|---|
| G1 | Clean return → bond released (E2E) | Covered | `tests/e2e/check-in-damage.spec.ts` |
| G2 | Damage → bond partial capture (E2E) | Covered | `tests/e2e/check-in-damage.spec.ts` |
| G3 | Damage map markers persisted (E2E + unit) | Covered | `tests/e2e/damage-map.spec.ts` + `tests/unit/components/damage-map-canvas.test.ts` |
| G4 | Return staff task auto-collection | Covered | `tests/unit/services/task-collectors/returns.test.ts` |
| G5 | Inspection router happy path + errors | Covered | `tests/unit/trpc/router/inspection.test.ts` |

## H. Extension (customer or staff)

| # | Scenario | Status | Reference |
|---|---|---|---|
| H1 | 1-day extension — daily rate, no discount | Covered | `tests/unit/extension.test.ts` |
| H2 | 8-day extension — weekly rate + 10% discount | Covered | `tests/unit/extension.test.ts` |
| H3 | Extension during peak season — multiplier applied | Covered | `tests/unit/extension.test.ts` |
| H4 | Extension addons + insurance sum correctly | Covered | `tests/unit/extension.test.ts` |
| H5 | Extension rejects non-forward time | Covered | `tests/unit/extension.test.ts` |

## I. Cancellation + no-show

| # | Scenario | Status | Reference |
|---|---|---|---|
| I1 | >72h before pickup — full refund minus $25 | Covered | `tests/unit/fees.test.ts` |
| I2 | 24–72h — 50% refund minus admin fee | Covered | `tests/unit/fees.test.ts` |
| I3 | <24h — no refund | Covered | `tests/unit/fees.test.ts` |
| I4 | Admin fee never exceeds gross refund | Covered | `tests/unit/fees.test.ts` |
| I5 | No-show detector job | Covered | `tests/payments/no-show-detector.test.ts` |

## J. Overdue + late return

| # | Scenario | Status | Reference |
|---|---|---|---|
| J1 | Late fee — within grace (no charge) | Covered | `tests/unit/fees.test.ts` |
| J2 | Late fee — 3h late charges hourly rate | Covered | `tests/unit/fees.test.ts` |
| J3 | Late fee — capped at daily rate per 24h | Covered | `tests/unit/fees.test.ts` |
| J4 | Overdue job — transitions ACTIVE→OVERDUE + 4-stage escalation ladder (1h/12h/24h/72h) | Implemented, not unit-tested | `src/server/jobs/overdue-check.ts` — uses `prisma.$transaction` directly; would need heavier mocking or DB integration test |

## K. Payments, bond, charges

| # | Scenario | Status | Reference |
|---|---|---|---|
| K1 | Happy path charge capture | Covered | `tests/payments/happy-path.test.ts` |
| K2 | Gateway failure recovery | Covered | `tests/payments/gateway-failure.test.ts` |
| K3 | Capture pending payments | Covered | `tests/payments/capture-pending-payments.test.ts` |
| K4 | Capture retry with backoff | Covered | `tests/payments/capture-retry.test.ts` |
| K5 | Confirm charge flow | Covered | `tests/payments/confirm-charge.test.ts` |
| K6 | Chargeback / dispute response | Covered | `tests/payments/chargeback-response.test.ts` + `tests/payments/dispute-response.test.ts` |
| K7 | Webhook replay safety | Covered | `tests/payments/webhook-replay.test.ts` |
| K8 | Stripe webhook signature + event routing | Covered | `tests/unit/webhooks/stripe.test.ts` |
| K9 | Stripe reconcile job | Covered | `tests/payments/stripe-reconcile.test.ts` |
| K10 | Stripe customer sync | Covered | `tests/payments/stripe-customer.test.ts` |
| K11 | Invoice generation job | Covered | `tests/payments/invoice-generate.test.ts` |
| K12 | Dunning ladder (unpaid debt escalation) | Covered | `tests/payments/dunning-ladder.test.ts` |
| K13 | Debt reminder job | Covered | `tests/unit/jobs/debt-reminder.test.ts` |
| K14 | Payment metrics | Covered | `tests/payments/metrics.test.ts` |
| K15 | Integration audit for payment flows | Covered | `tests/payments/integration-audit.test.ts` |
| K16 | Stub guard (tests fail loudly if Stripe stub mode leaks) | Covered | `tests/payments/stub-guard.test.ts` |
| K17 | Gift card issue + redeem | Covered | `tests/unit/services/gift-card.test.ts` |
| K18 | Revenue reconcile job | Covered | `tests/unit/jobs/revenue-reconcile.test.ts` |
| K19 | Subscription billing job | Covered | `tests/unit/jobs/subscription-billing.test.ts` |
| K20 | Toll admin fee | Covered | `tests/payments/toll-admin-fee.test.ts` |
| K21 | Revenue aggregator totals | Covered | `tests/unit/services/revenue-aggregator.test.ts` |

## L. Incidents

| # | Scenario | Status | Reference |
|---|---|---|---|
| L1 | Admin incidents summary | Covered | `tests/unit/services/admin-risk-signals.test.ts` |
| L2 | Thefts-open signal | Covered | `tests/unit/services/admin-risk-signals.test.ts` |
| L3 | Staff ops incident signals | Covered | `tests/unit/services/staff-ops-signals.test.ts` |

## M. Infringements + toll

| # | Scenario | Status | Reference |
|---|---|---|---|
| M1 | E-toll workbook parsing | Covered | `tests/unit/trpc/router/etoll.test.ts` |
| M2 | E-toll sync job | Covered | `tests/unit/trpc/router/etoll.test.ts` |
| M3 | E-toll health monitoring | Covered | `tests/payments/etoll-health.test.ts` |
| M4 | Linkt toll provider | Covered | `tests/unit/lib/linkt.test.ts` |
| M5 | Unpaid infringement dunning escalation | Covered | `tests/payments/dunning-ladder.test.ts` |
| M6 | Unpaid infringements summary (admin risk) | Covered | `tests/unit/services/admin-risk-signals.test.ts` |

## N. Maintenance + fleet

| # | Scenario | Status | Reference |
|---|---|---|---|
| N1 | Work-order staff task auto-collection | Covered | `tests/unit/services/task-collectors/work-orders.test.ts` |
| N2 | Maintenance alerts (rego / service / insurance / CTP — 60/30/14/7 day windows) | Implemented, not unit-tested | `src/server/jobs/maintenance-alert.ts` — job hits prisma directly; needs DB integration test |
| N3 | Fleet reassignment helper when vehicle decommissioned | Covered (service exists) | `src/server/services/fleet-reassign.ts` + exercised via `staff-ops-signals` |
| N4 | Depreciation per-vehicle calculation | Covered | `tests/depreciation.test.ts` |
| N5 | Open WO blocks vehicle availability | Covered | `tests/unit/availability.test.ts` |

## O. Inspections + damage map

| # | Scenario | Status | Reference |
|---|---|---|---|
| O1 | Damage map canvas rendering + marker placement | Covered | `tests/unit/components/damage-map-canvas.test.ts` + `tests/e2e/damage-map.spec.ts` |
| O2 | Inspection router (create, update, complete) | Covered | `tests/unit/trpc/router/inspection.test.ts` |
| O3 | Inspection staff task auto-collection | Covered | `tests/unit/services/task-collectors/inspections.test.ts` |

## P. Notifications + communications

| # | Scenario | Status | Reference |
|---|---|---|---|
| P1 | Resend email webhook (bounce, complaint, delivered) | Covered | `tests/unit/webhooks/resend.test.ts` |
| P2 | SMS phone normalisation (Australian) | Covered | `tests/unit/sms.test.ts` |
| P3 | Consent gating — SUSPENDED/BANNED block | Covered | `tests/unit/consent.test.ts` |
| P4 | Consent gating — per-channel, per-category opt-out | Covered | `tests/unit/consent.test.ts` |
| P5 | Support routing (channel selection) | Covered | `tests/unit/services/support-routing.test.ts` |
| P6 | Support channel matrix (when each channel fires) | Covered | `tests/unit/services/support-channel-matrix.test.ts` |
| P7 | Support AI guards | Covered | `tests/unit/services/support-ai-guards.test.ts` |
| P8 | Support cost caps | Covered | `tests/unit/services/support-cost.test.ts` |
| P9 | Post-trip review notification | Covered (indirect) | `src/server/jobs/post-trip-review.ts` (job exists; exercised via `task-collectors`) |

## Q. Customer portal

| # | Scenario | Status | Reference |
|---|---|---|---|
| Q1 | Customer auth + dashboard visibility | Covered | `tests/e2e/auth-and-portal.spec.ts` |
| Q2 | Loyalty — EARN on completion, BURN, tier thresholds | Covered | `tests/unit/services/loyalty.test.ts` |
| Q3 | Referral program | Covered | `tests/unit/services/referral.test.ts` |
| Q4 | Customer calendar integration (ICS) | Covered | `tests/unit/lib/calendar.test.ts` |
| Q5 | Weather display (post-trip / pre-pickup) | Covered | `tests/unit/lib/weather.test.ts` |
| Q6 | Presence (WebSocket live-view tracking) | Covered | `tests/unit/services/presence.test.ts` |
| Q7 | Live view router (public visitor tracking) | Covered | `tests/unit/trpc/router/live.test.ts` |

## R. Staff back-office

| # | Scenario | Status | Reference |
|---|---|---|---|
| R1 | Staff priority tasks queue | Covered | `tests/e2e/staff-tasks.spec.ts` |
| R2 | Staff ops signals | Covered | `tests/unit/services/staff-ops-signals.test.ts` |
| R3 | Task collectors — all types | Covered | `tests/unit/services/task-collectors/collect-all.test.ts` + per-type files |
| R4 | Staff customer search + licence verify | Covered | `tests/unit/trpc/router/staff-customer.test.ts` |
| R5 | Staff tasks management | Covered | `tests/unit/services/staff-tasks.test.ts` + `tests/unit/trpc/router/staff-task.test.ts` |
| R6 | Staff task auto-abandon (stale) | Covered (indirect) | `src/server/jobs/staff-task-auto-abandon.ts` |

## S. Admin

| # | Scenario | Status | Reference |
|---|---|---|---|
| S1 | Admin risk signals — incidents, thefts, debtors, unpaid infringements | Covered | `tests/unit/services/admin-risk-signals.test.ts` |
| S2 | Admin report configs | Covered | `tests/unit/components/admin/report-configs.test.ts` |
| S3 | System settings | Covered | `tests/unit/lib/settings.test.ts` |
| S4 | Subscription products + plans | Covered | `tests/unit/services/subscription.test.ts` + `tests/unit/trpc/router/subscription.test.ts` |
| S5 | Partner (B2B account) management | Covered | `tests/unit/services/partner.test.ts` + `tests/unit/trpc/router/partner.test.ts` |
| S6 | Segment evaluation for campaigns | Covered | `tests/unit/segment.test.ts` |

## T. Security, compliance, public pages

| # | Scenario | Status | Reference |
|---|---|---|---|
| T1 | Public homepage renders hero + CTA | Covered | `tests/e2e/public-pages.spec.ts` |
| T2 | Live view visitor cookie | Covered | `tests/e2e/live-view.spec.ts` |
| T3 | Geolocation helpers | Covered | `tests/unit/geo.test.ts` |
| T4 | Telemetry event routing | Covered | `tests/unit/webhooks/telemetry.test.ts` + `tests/unit/lib/telemetry.test.ts` |

## U. Booking lifecycle (integration)

| # | Scenario | Status | Reference |
|---|---|---|---|
| U1 | Quote + pricing + addons + insurance totals | Covered | `tests/integration/booking-flow.test.ts` |
| U2 | Status machine legal/illegal transitions | Covered | `tests/integration/booking-flow.test.ts` |
| U3 | Late return triggers correct fee | Covered | `tests/integration/booking-flow.test.ts` |

## V. Utility / shared

| # | Scenario | Status | Reference |
|---|---|---|---|
| V1 | Shared utils | Covered | `tests/utils.test.ts` |

---

## Gaps — implementation missing (catalogued as `.skip` in `_gaps.test.ts`)

| # | Missing feature | Why it's not tested |
|---|---|---|
| 1 | Phone verification enforcement | `User.phoneVerified` exists (and is cleared on anonymisation) but nothing sets it — no send/confirm-code flow and no check-out gate. |
| 2 | Session revocation endpoint | JWT strategy relies on expiry only; no admin-side force-logout / token epoch. |
| 3 | PHONE / AGENT booking source | `BookingSource.PHONE` / `.AGENT` exist in Prisma but no code path writes either. |
| 4 | Inter-depot transfer order | Post-return relocation works; `TransferOrder` model + scheduler + `vehicle.depotId` flip missing. |

When any of these lands, remove the corresponding `.skip` and replace with a
real test. The gap stubs live in `tests/unit/_gaps.test.ts` so they surface
as pending in every `npm test` run.

### Closed gaps (reconciled 2026-08-11, NT-016)

Five rows from the original nine-gap audit describe features that have since
shipped. Their stubs were deleted and replaced by real tests; the old numbers
are kept here so earlier references still resolve.

| Old # | Feature | Shipped as | Now covered by |
|---|---|---|---|
| 1 | Password reset flow | `auth.requestPasswordReset` + `auth.resetPassword`; `/forgot-password`, `/reset-password` | `tests/unit/trpc/router/auth.test.ts` |
| 2 | Magic link sign-in provider | NextAuth Nodemailer provider in `src/lib/auth.ts` + `emails/magic-link.tsx` | `tests/unit/lib/auth-signin.test.ts` |
| 3 | Email verification enforcement | QA Round-2 M4 (`scripts/backfill-email-verified.ts`, `/verify-email`) | `tests/unit/trpc/router/auth.test.ts` |
| 5 | 2FA / TOTP for staff | `src/server/trpc/router/totp.ts`, step-up gate in `src/lib/auth-step-up.ts` | `tests/unit/lib/totp.test.ts`, `tests/unit/lib/auth-step-up-token.test.ts`, `tests/unit/trpc/router/auth-step-up.test.ts` |
| 6 | Login rate-limiting (10 / 15 min) | `auth:preauth` bucket + `LOADTEST_RATELIMIT_OFF` kill-switch | `tests/unit/lib/rate-limit.test.ts`, `tests/unit/trpc/router/auth.test.ts` |

---

## How this file is maintained

When adding a new scenario:

1. Append a row to the relevant module table.
2. Link the test file.
3. Leave `GAP` pointing at `_gaps.test.ts` if implementation is deferred.

When fixing a gap:

1. Remove the `.skip` in `_gaps.test.ts`.
2. Move the corresponding row out of the Gaps table.
3. Link the new test file in the module table.
