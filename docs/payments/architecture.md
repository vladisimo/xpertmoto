# Payments — Architecture & Data Flow

**Status:** Phase 1 discovery artefact. Captures what exists today (2026-04-18).
**Companion docs:** [state-machines.md](./state-machines.md), [integrations.md](./integrations.md), [risk-register.md](./risk-register.md), [reconciliation-spec.md](./reconciliation-spec.md), [compliance.md](./compliance.md).

---

## 1. Scope

This document maps every code path by which money moves — or fails to move — through XPERT Moto. It is intentionally literal: every arrow corresponds to a function call in the current codebase with file and function references. Gaps (paths the spec demands but the code does not implement) are called out inline with the `[G<n>]` marker that matches the risk register.

## 2. Top-level actor diagram

```mermaid
flowchart LR
  Customer([Customer])
  Staff([Staff])
  Cron((BullMQ scheduler))
  StripeAPI[[Stripe API]]
  StripeHook[[Stripe webhook]]
  NSWEToll[[NSW E-Toll portal]]
  Twilio[[Twilio]]
  Resend[[Resend]]

  Customer -->|"booking.create / .confirmPayment"| App
  Staff -->|"staff-booking.checkInBooking / chargeCustomerForDamage / ..."| App
  Cron -->|"bond-auto-release, overdue-check, debt-reminder, revenue-reconcile, pending-payment-ttl, etoll-sync"| App
  App -->|"createPaymentIntent / createBondHold / cancelPaymentIntent"| StripeAPI
  StripeHook -->|"POST /api/webhooks/stripe"| App
  NSWEToll -->|"Playwright scrape (etoll-sync)"| App
  App -->|"sendNotification"| Twilio
  App -->|"sendNotification"| Resend

  subgraph App[XPERT Moto Next.js app]
    direction TB
    TRPC[tRPC routers]
    Jobs[BullMQ workers]
    Services[Services]
    DB[(PostgreSQL)]
    TRPC --> Services
    Jobs --> Services
    Services --> DB
  end
```

## 3. Booking → payment → confirmation

The canonical happy path. Vehicle allocation is deferred until payment is captured so that an unpaid quote cannot reserve stock.

```mermaid
sequenceDiagram
  autonumber
  participant C as Customer (browser)
  participant Web as Next.js / tRPC
  participant S as Stripe API
  participant WH as Webhook handler
  participant DB as Postgres

  C->>Web: booking.quote (pricing preview)
  Web-->>C: quote snapshot (subtotal, bond, GST)
  C->>Web: booking.create (+ agreedToTerms)
  Web->>S: paymentIntents.create (capture=automatic)
  Web->>S: paymentIntents.create (capture=manual)  %% bond
  Web->>DB: insert Booking (PENDING_PAYMENT)
  Web-->>C: { clientSecret, bondClientSecret }
  C->>S: confirmCardPayment via Stripe Elements
  S-->>C: payment succeeded / requires_action
  S->>WH: payment_intent.succeeded
  WH->>DB: update Payment.status = SUCCEEDED
  C->>Web: booking.confirmPayment (piId)
  Web->>DB: advisory_lock(depotId, categoryId)
  Web->>DB: allocate Vehicle, update Booking=CONFIRMED
  Web->>DB: upsert BondLedger (HELD)
  Web-->>C: final booking record
  Web->>C: notification (email + SMS via sendNotification)
```

**Code references**

- Quote: [src/server/trpc/router/booking.ts](/home/vlad/scootering/src/server/trpc/router/booking.ts) `quote`.
- Create: same file, `create` (creates PI + bond PI, persists Booking).
- Confirm: same file, `confirmPayment` (advisory lock + vehicle allocation + Payment row + BondLedger upsert).
- Stripe wrapper: [src/lib/stripe.ts](/home/vlad/scootering/src/lib/stripe.ts) `createPaymentIntent` (automatic capture), `createBondHold` (manual capture).
- Webhook: [src/app/api/webhooks/stripe/route.ts](/home/vlad/scootering/src/app/api/webhooks/stripe/route.ts) handles `payment_intent.succeeded`, `.amount_capturable_updated`, `.payment_failed`, `.canceled`, `charge.refunded`, `charge.dispute.created`, identity events.

**Gaps on this path**

- [G1] Webhook events are not logged to a dedup table; handlers are idempotent-by-shape but we can't prove a replay was processed exactly once.
- [G11] No 3DS2 / SCA step — `requires_action` is not wired on the client side.
- [G13] `writeAudit` is not called from `confirmPayment`; only `withAudit` on the webhook route captures the request.

## 4. Check-in → bond capture → additional charges

```mermaid
sequenceDiagram
  autonumber
  participant Staff
  participant Web as tRPC staff-booking
  participant DB
  participant S as Stripe API

  Staff->>Web: staffBooking.checkInBooking
  Web->>DB: begin $transaction
  Web->>DB: compute late / fuel / damage fees
  alt damage <= bondHeld
    Web->>DB: Payment(type=DAMAGE_CHARGE, status=PENDING, amount=fromBond)
    Web->>DB: BondLedger.capturedAmount += fromBond
    Web->>DB: BondLedger.status=FULLY|PARTIALLY_CAPTURED
  else damage > bondHeld
    Web->>DB: Payment(DAMAGE_CHARGE, PENDING, fromBond)
    Web->>DB: Payment(DAMAGE_CHARGE, PENDING, fromCard — ref INC-...-CARD)
    Web->>DB: BondLedger.status=FULLY_CAPTURED
  end
  Web->>DB: Payment(LATE_FEE|FUEL_CHARGE, PENDING) as applicable
  Web->>DB: Booking.status = RETURNED | COMPLETED, balanceDue updated
  Web->>DB: commit
  Web->>Web: sendNotification + recordBookingCompletion
  Note over Web,S: No Stripe capture call is made here [G5, G8]
```

**Gaps on this path**

- [G5] PENDING Payment rows created here are never captured downstream. There is no job that walks PENDING Payments and calls Stripe.
- [G8] If a Stripe capture call were added inline, there is no retry queue; a transient Stripe 5xx would force the entire DB transaction to roll back and lose the bond state.
- [G9] No `PaymentEvent` append-only log; `Payment.status` is mutated in place, losing transition history.

## 5. Refund / chargeback

```mermaid
sequenceDiagram
  autonumber
  participant S as Stripe
  participant WH as Webhook handler
  participant DB
  participant Rev as revenue-aggregator

  S->>WH: charge.refunded
  WH->>DB: Payment.status = REFUNDED | PARTIALLY_REFUNDED
  WH->>Rev: recordRefund(depotId, amount)
  Rev->>DB: DailyRevenue.totalRefunds += amount
  WH->>Rev: invalidateRevenueCaches(depotId)

  S->>WH: charge.dispute.created
  WH->>DB: Payment.status = DISPUTED
  Note over WH: No Incident row, no manager notification, no evidence queued [G2]
```

**Gaps**

- [G2] `charge.dispute.created` only flips `Payment.status`. No `Incident` is created, no manager notified, no representment evidence packet scheduled.
- [G12] No evidence compilation pipeline.

## 6. E-Toll ingestion → Infringement → recovery

```mermaid
flowchart TD
  A[BullMQ: etoll-sync every 6h] --> B[Playwright login to myetoll.transport.nsw.gov.au]
  B --> C[Download XLSX activity]
  C --> D[parseEtollWorkbook]
  D --> E{matchTripRow<br/>rego/tag + time window}
  E -->|matched| F[upsertInfringementFromRow<br/>status=CUSTOMER_CHARGED<br/>referenceNumber=SHA256...]
  E -->|no match| G[EtollUnmatchedRow<br/>manual admin review]
  F --> H[(Infringement table)]
  H -.->|staff manually invokes| I[fleet.chargeCustomerForInfringement]
  I --> J[Payment INFRINGEMENT_RECOVERY<br/>status=PENDING]
  J -.->|never captured| K[[Stripe card charge]]
```

**Code references**

- Scraper: [src/server/services/etoll.ts](/home/vlad/scootering/src/server/services/etoll.ts) `loginAndDownloadActivity`, `parseEtollWorkbook`, `matchTripRow`, `upsertInfringementFromRow`, `runEtollSync`.
- Scheduler: [src/server/jobs/etoll-sync.ts](/home/vlad/scootering/src/server/jobs/etoll-sync.ts) `startEtollScheduler`.
- Recovery mutation: [src/server/trpc/router/fleet.ts](/home/vlad/scootering/src/server/trpc/router/fleet.ts) `chargeCustomerForInfringement`.

**Gaps**

- [G5] Same capture gap — INFRINGEMENT_RECOVERY Payments remain PENDING forever.
- [G10] No admin fee / markup; `Infringement.amount` = raw toll.
- [G18] Linkt (VIC/QLD) integration is a stub — placeholder file only.
- [G6] Even if capture were added, there is no stored payment method to charge off-session once the booking has ended.

## 7. Background jobs — money-touching

| Job | Schedule | What it does | File |
|-----|----------|--------------|------|
| `pending-payment-ttl` | Nightly 03:00 AEST | Cancels `PENDING_PAYMENT` / `QUOTE` bookings older than 24h | [jobs/pending-payment-ttl.ts](/home/vlad/scootering/src/server/jobs/pending-payment-ttl.ts) |
| `bond-auto-release` | Nightly 02:00 | Releases bonds > 14d old on COMPLETED/RETURNED bookings | [jobs/bond-auto-release.ts](/home/vlad/scootering/src/server/jobs/bond-auto-release.ts) |
| `debt-reminder` | Daily 09:00 | One-shot reminder to debtors > threshold (cooldown-gated) | [jobs/debt-reminder.ts](/home/vlad/scootering/src/server/jobs/debt-reminder.ts) |
| `revenue-reconcile` | Nightly 02:15 | Rebuilds `DailyRevenue` rows from Booking aggregates | [jobs/revenue-reconcile.ts](/home/vlad/scootering/src/server/jobs/revenue-reconcile.ts) |
| `overdue-check` | Every 15 min | 4-stage escalation ladder on overdue bookings | [jobs/overdue-check.ts](/home/vlad/scootering/src/server/jobs/overdue-check.ts) |
| `etoll-sync` | Every 6h | Scrape + ingest NSW tolls | [jobs/etoll-sync.ts](/home/vlad/scootering/src/server/jobs/etoll-sync.ts) |

**Gaps — missing jobs**

- [G3] No Stripe-to-ledger reconciliation job.
- [G5] No PENDING-payment capture job.
- [G7] Dunning is one-shot; no 2nd / final / collections / write-off stages.
- [G8] No Stripe-capture retry queue.
- [G17] No invoice-generate job.

## 8. Trust boundaries

```mermaid
flowchart LR
  subgraph External
    Stripe
    NSWEToll
    Twilio
    Resend
  end
  subgraph Internal[XPERT Moto VPC]
    App
    DB[(Postgres)]
    Redis
  end
  Browser -.->|HTTPS| App
  App -.->|HTTPS + bearer| Stripe
  App -.->|Playwright headless| NSWEToll
  App -.->|HTTPS| Twilio
  App -.->|HTTPS| Resend
  Stripe -.->|signed webhook| App
  App --- DB
  App --- Redis
```

- **PAN**: never touches our servers. Stripe Elements / PaymentSheet in the browser posts directly to Stripe; we receive only tokens (`pi_...`, `ch_...`, `cus_...`).
- **Secrets**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, E-Toll credentials live in `SystemSetting` (AES-256-GCM encrypted) with env-var fallback. See [src/lib/integration-config.ts](/home/vlad/scootering/src/lib/integration-config.ts).
- **Logs**: PII is redacted via pino paths (`stripePaymentIntentId`, licence, email, phone). Amounts are **not** currently redacted [G13].

## 9. Open questions that the other Phase-1 docs resolve

- *Exact* state machines for `Payment`, `BondLedger`, `DamageCharge`, `Infringement` → [state-machines.md](./state-machines.md).
- *Exact* auth model + failure modes for Stripe / E-Toll / Linkt / Twilio / Resend → [integrations.md](./integrations.md).
- *Likelihood × impact* scoring for each gap → [risk-register.md](./risk-register.md).
