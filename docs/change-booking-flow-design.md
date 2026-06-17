# Design: Self-service "Change booking" flow (M-5)

**Status:** Proposed — design only. Not built. Tracked from the QA hardening
report (`tests/XpertMoto-QA-Hardening-Report.md`, finding **M-5**).

## Problem

Today the only self-service modification a customer can make to a `CONFIRMED`
booking is **Extend return date** (`booking.extend`). Every other change —
shorten/shift dates, change pickup time, swap vehicle category, or change
add-ons/insurance — forces a **cancel + rebook**, which triggers the
cancellation fee tiers and a fresh deposit/refund cycle. The QA report flags
this as a notable UX/conversion gap.

The decision on the hardening pass was to **design** this flow now and build it
as a separate, scoped feature later (it is effectively its own project touching
pricing, availability, payments, and audit).

## What exists to build on

The extend flow is the template — mirror it rather than inventing new patterns.

- **`booking.extend`** — [src/server/trpc/router/booking.ts:1043](../src/server/trpc/router/booking.ts#L1043).
  Authorises ownership, gates on status (`CONFIRMED` / `CHECKED_OUT` /
  `ACTIVE`), reprices the delta via `quoteExtension`, raises an `EXTENSION`
  payment, and updates `returnDateTime` / `durationDays` / `totalAmount` /
  `balanceDue` in one transaction.
- **`quoteExtension`** — `@/server/services/pricing`; computes the price delta
  for a date change at current rates.
- **Availability** — `countAvailable` / `isVehicleFree` in
  [src/server/services/availability.ts](../src/server/services/availability.ts).
- **Balance invariant** — [src/lib/balance-due.ts](../src/lib/balance-due.ts):
  every balance-affecting charge increments `Booking.balanceDue` on raise; all
  capture/void paths decrement it (see `balance_due_invariant` memory).
- **Cancellation/decrease** — `booking-cancellation.ts` already models writing
  an invoice down (`buildSupplyNotProvidedDecrease`) — reuse for shorten/refund.
- **Customer UI** — `booking-sticky-actions.tsx` (the Extend/Cancel buttons) and
  the extend modal pattern.

## Proposed scope (phased)

### Phase A — date/time changes (lowest risk, highest demand)
A unified `booking.change` mutation (or extend `quoteExtension` into a
bidirectional `quoteDateChange`) that handles:
- **Shorten** return date → price **decrease**: write the invoice down to
  retained consideration per the cancellation-decrease rules, refund the
  overpaid online portion, decrement `balanceDue`.
- **Shift** pickup and/or return (same duration or different) → re-run the
  availability + 2-hour buffer + depot-hours guards for the new window, reprice
  the whole booking at current rates, settle the delta (charge or refund).
- **Change pickup time** within the same day → availability + depot-hours
  re-check; usually price-neutral.

Status gate: `CONFIRMED` only for date moves that affect allocation; allow
`CHECKED_OUT`/`ACTIVE` only for extensions (already supported) — do **not** let
an active rental shift its pickup into the past.

### Phase B — add-ons / insurance changes
Re-quote with the new extras/insurance, settle the delta. Reuse the step-3
catalogue queries. Insurance downgrade (Standard → free Basic) is a refund;
upgrade is a charge. Respect the M-7 clarity rules in the UI.

### Phase C — category / vehicle swap (highest risk)
Likely **staff-assisted** rather than fully self-service: a category swap
changes base rate, eligibility (re-run `checkEligibility` — see H-3), bond, and
availability. Recommend surfacing a "Request a change" path that routes to staff
via the existing `booking-swap.ts` staff router rather than letting customers
self-swap categories unsupervised.

## Cross-cutting requirements
- **Idempotency / drafts:** any new charge follows the H-4 + `balance-due`
  patterns; never double-charge on retry.
- **Cancellation-fee interaction:** a *change* must not be a backdoor around the
  cancellation tiers. Define which changes are free vs fee-bearing (e.g. a
  shorten inside the 24h window still applies the no-refund tier).
- **Audit:** every change writes a `BOOKING_*` audit row (mirror `extend`).
- **Tests:** unit tests for the new pricing-delta + status gates (happy + each
  failure), Playwright optimistic smoke for the change modal.
- **Notifications:** confirmation email on a successful change (reuse the
  booking-modified template family).

## Out of scope for this design
Pricing-policy decisions (which changes incur fees, refund timing) need product
sign-off before Phase A is built.
