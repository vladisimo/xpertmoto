# Payments — Reconciliation Engine Specification

**Status:** Phase 3 discovery + design artefact.
**Purpose:** Define the triple-match reconciliation (system ↔ Stripe ↔ bank), the sub-ledger contract, cutover windows, and the exact schema additions required to implement it. Implementation of the reconciliation **job itself** is G3 — scheduled for P1, deferred from this run. What this document produces now is the **specification** that the P1 implementation will follow.

---

## 1. Reconciliation model

Three independent sources of truth must agree, every day, to within zero variance:

```
          Scootering DB (Payment rows)
                   ↕  (match by stripeChargeId)
              Stripe API
         (/v1/balance_transactions)
                   ↕  (match by payout id)
              Bank statement CSV
            (NAB / Westpac / equivalent)
```

### Matching keys

- **DB ↔ Stripe**: `Payment.stripeChargeId = Stripe.Charge.id` OR `Payment.stripePaymentIntentId = Stripe.PaymentIntent.id`.
- **Stripe ↔ Bank**: Stripe payouts (`po_...`) post a single lump to our bank per day. Match by amount + date. Bank CSV reference (e.g. "Stripe Payout") identifies them.

### Comparison units

- All comparisons in **cents (integer)**. Stripe returns cents natively. Our `Decimal(10,2)` is converted with `Math.round(Number(amount) * 100)`.

### Tolerances

- Amount: **0 cents** (exact match required).
- Time: payments created up to 2 days before settlement are considered in the same bucket (Stripe settlement typically T+2).
- FX: not applicable (AUD only). If an FX charge appears, flag for manual review.

---

## 2. Sub-ledger contract

Every booking is expected to yield a closed sub-ledger whose total nets to the total paid by the customer:

```
  Σ Payment(booking=B, status∈{SUCCEEDED})
- Σ Payment(booking=B, status=REFUNDED, amount)
- Σ Payment(booking=B, status=PARTIALLY_REFUNDED, amount_refunded_from_Stripe)
= Booking.amountPaid
```

And a parallel bond ledger:

```
  BondLedger(B).heldAmount
= BondLedger(B).capturedAmount + BondLedger(B).releasedAmount + stillHeldPortion
```

`stillHeldPortion = 0` in terminal states (FULLY_CAPTURED, RELEASED).

These invariants appear in [state-machines.md §7](./state-machines.md) and become automated checks in the reconciliation job.

### Materialised view (proposed)

For admin dashboards and reconciliation queries, a Postgres materialised view refreshed nightly:

```sql
CREATE MATERIALIZED VIEW booking_payment_summary AS
SELECT
  b.id                           AS booking_id,
  b."bookingReference"           AS booking_reference,
  b."totalAmount"                AS booking_total,
  COALESCE(SUM(p.amount) FILTER (
    WHERE p.status = 'SUCCEEDED'
  ), 0)                          AS total_captured,
  COALESCE(SUM(p.amount) FILTER (
    WHERE p.status IN ('REFUNDED','PARTIALLY_REFUNDED')
  ), 0)                          AS total_refunded,
  bl."heldAmount"                AS bond_held,
  bl."capturedAmount"            AS bond_captured,
  bl."releasedAmount"            AS bond_released,
  (b."totalAmount" - COALESCE(SUM(p.amount) FILTER (WHERE p.status='SUCCEEDED'), 0))
                                 AS booking_balance_due
FROM "Booking" b
LEFT JOIN "Payment" p ON p."bookingId" = b.id AND p.type = 'BOOKING_PAYMENT'
LEFT JOIN "BondLedger" bl ON bl."bookingId" = b.id
GROUP BY b.id, bl."heldAmount", bl."capturedAmount", bl."releasedAmount";

CREATE UNIQUE INDEX ON booking_payment_summary (booking_id);
```

Refresh strategy: `REFRESH MATERIALIZED VIEW CONCURRENTLY booking_payment_summary` at the end of `revenue-reconcile` job.

---

## 3. Schema additions (Phase 4 migrations)

Four new models to support reconciliation + the P0 work. All are additive — no existing model is destructively altered.

### 3.1 `StripeWebhookEvent` (G1 — P0, this run)

Event log + replay dedup. Insert-then-process pattern: a webhook handler inserts the row with `status=RECEIVED` before doing any side-effect work; a unique constraint on `id` makes a duplicate insert a no-op.

```prisma
model StripeWebhookEvent {
  id           String                   @id            // Stripe event id, e.g. evt_1M...
  type         String                                  // e.g. payment_intent.succeeded
  apiVersion   String?                                 // event.api_version
  livemode     Boolean                                  // event.livemode
  payload      Json                                     // full event object
  receivedAt   DateTime                 @default(now())
  processedAt  DateTime?
  status       StripeWebhookEventStatus @default(RECEIVED)
  errorReason  String?
  attempts     Int                      @default(0)

  @@index([type, receivedAt])
  @@index([status, receivedAt])
}

enum StripeWebhookEventStatus {
  RECEIVED
  PROCESSING
  PROCESSED
  FAILED
}
```

### 3.2 `PaymentEvent` (G9 — P1, deferred)

Append-only history of every Payment.status mutation. Enables replay-based tests and forensic audit.

```prisma
model PaymentEvent {
  id                String            @id @default(cuid())
  paymentId         String
  eventType         PaymentEventType
  previousStatus    PaymentStatus?
  newStatus         PaymentStatus?
  amountDelta       Decimal?          @db.Decimal(10, 2)
  source            String             // "webhook", "tRPC", "job:capture-pending-payments", etc.
  stripeEventId     String?            // link to StripeWebhookEvent.id if applicable
  actorUserId       String?            // tRPC session user, if any
  data              Json               @default("{}")
  createdAt         DateTime          @default(now())

  payment Payment @relation(fields: [paymentId], references: [id])

  @@index([paymentId, createdAt])
  @@index([stripeEventId])
  @@index([eventType, createdAt])
}

enum PaymentEventType {
  CREATED
  STATUS_CHANGED
  CAPTURED
  REFUNDED
  DISPUTED
  VOIDED
  RETRY_ATTEMPTED
  RETRY_EXHAUSTED
}
```

### 3.3 `StripeFeeLedger` (G3 — P1, deferred)

Records Stripe processing fees + other `balance_transactions` fee types per charge. Used for net-revenue reporting.

```prisma
model StripeFeeLedger {
  id                  String   @id @default(cuid())
  stripeChargeId      String   @unique
  stripePayoutId      String?
  feeType             String    // "stripe_fee", "application_fee", "tax"
  feeAmountCents      Int
  netAmountCents      Int
  currency            String
  balanceTxnCreatedAt DateTime
  payoutArrivedAt     DateTime?
  createdAt           DateTime @default(now())

  @@index([stripePayoutId])
  @@index([balanceTxnCreatedAt])
}
```

### 3.4 `UnmatchedTransaction` (G3 — P1, deferred)

Queue of transactions that failed to match DB ↔ Stripe in either direction.

```prisma
model UnmatchedTransaction {
  id            String                    @id @default(cuid())
  source        UnmatchedTransactionSource
  externalId    String                      // stripe charge / payout / bank-ref id
  amountCents   Int
  occurredAt    DateTime
  reason        String                       // "no_matching_payment", "amount_mismatch", ...
  resolvedAt    DateTime?
  resolvedById  String?
  resolvedNote  String?
  payload       Json                         // raw source record
  createdAt     DateTime                  @default(now())

  @@index([source, resolvedAt])
  @@index([occurredAt])
}

enum UnmatchedTransactionSource {
  STRIPE_CHARGE
  STRIPE_PAYOUT
  BANK_STATEMENT
  SYSTEM_LEDGER
}
```

### 3.5 Migration ordering

1. `stripe_webhook_event_log` (G1, P0, this run) — required before handler rewrite.
2. `payment_event_log` (G9, P1, deferred) — Payment model gets a reverse relation to PaymentEvent.
3. `stripe_fee_ledger` (G3, P1, deferred).
4. `unmatched_transaction` (G3, P1, deferred).

Each migration is a separate Prisma migration directory with a clear descriptive name. P0 work in this run produces only the first.

---

## 4. Cutover windows

All times in **Australia/Brisbane** (AEST, no DST).

| Window | Runs at | Produces | Notes |
|--------|---------|----------|-------|
| End-of-day (EOD) | 00:30 daily | `DailyRevenue` for prior day (already implemented as `revenue-reconcile`) | Future: triggers `stripe-reconcile` P1 job after EOD. |
| End-of-month (EOM) | 01:00 on 1st of month | Monthly GST summary, accountant CSV export | Semi-automated; P1 deliverable. |
| End-of-quarter (EOQ) | 01:00 on 1st of Jan/Apr/Jul/Oct | BAS export | Manual review before lodgement. |
| End-of-financial-year (EOFY) | 01:00 on 1 July | Annual asset register, depreciation, P&L by depot | Existing `eofy-report` job (confirm); if missing, P2. |

### Timezone handling

`DailyRevenue.date` is stored as `DateTime` in DB with UTC canonical; the revenue-reconcile job groups by date in `Australia/Brisbane`. This is confirmed in [revenue-reconcile.ts](/home/vlad/scootering/src/server/jobs/revenue-reconcile.ts). Any new reconciliation job must respect the same boundary.

---

## 5. Unmatched aging SLA

Buckets and target time-to-resolution:

| Aging bucket | Count threshold | SLA | Action |
|--------------|-----------------|-----|--------|
| 0–24 h | any | investigate next business day | Admin dashboard card highlights |
| 1–7 d | >0 | 3 business days | Email finance lead |
| 7–30 d | >0 | 5 business days | Manager escalation, flag for external audit |
| >30 d | >0 | **P0 alert** | CFO notification; halt new reconciliations until resolved |

Admin dashboard (G14 metric + P1 UI) shows the counts per bucket.

---

## 6. Reconciliation job (G3) — contract

*Implementation is deferred to P1. This section specifies its contract so the tests can be written now.*

### Inputs

- Start checkpoint: `SystemSetting.reconcile:stripe:lastCheckpoint` (default: 14 days ago).
- End checkpoint: `now - 10 minutes` (guard against event in flight).

### Steps

1. Paginate Stripe `balance_transactions.list({ created: { gte: start, lte: end }, limit: 100 })` cursored until exhausted.
2. For each `charge` type:
   - Look up `Payment` by `stripeChargeId`. Insert `StripeFeeLedger` row (idempotent on `stripeChargeId`).
   - If no match, insert `UnmatchedTransaction(source=STRIPE_CHARGE)`.
3. For each `refund` type:
   - Look up `Payment` by `stripeChargeId`. Assert status is `REFUNDED` or `PARTIALLY_REFUNDED`. If not, insert `UnmatchedTransaction`.
4. For each `payout` type:
   - Record `stripePayoutId` + `payoutArrivedAt` into all `StripeFeeLedger` rows in the window.
5. Reverse pass: `Payment.status=SUCCEEDED` rows in the window with no matching Stripe balance transaction → `UnmatchedTransaction(source=SYSTEM_LEDGER)`.
6. Refresh materialised view.
7. Update checkpoint.

### Outputs

- New rows in `StripeFeeLedger` and `UnmatchedTransaction`.
- Metrics (G14 P1): `reconcile_runs_total`, `reconcile_unmatched_total{source}`.
- Slack alert if unmatched >0 in >30d bucket.

### Idempotency

- Unique keys make reruns safe: `StripeFeeLedger.stripeChargeId` unique; `UnmatchedTransaction` can tolerate dupes but dedup on `(source, externalId)` via index.

---

## 7. Bank statement ingestion

Accepted formats:

- NAB / Westpac / ANZ / CBA CSV export (comma-delimited, UTF-8, one transaction per row).
- Date, amount, reference, description are the four required columns.

### Flow (P1)

- Admin uploads CSV via admin UI → stored in S3.
- `bank-statement-ingest` job parses, writes to `BankStatementRow` (new table, not specified here — P1 design doc).
- Matches by (amount + date ± 2 days) against `StripeFeeLedger.stripePayoutId`.
- Unmatched → `UnmatchedTransaction(source=BANK_STATEMENT)`.

*Design deferred; this section is a placeholder so the table is clearly outside this run's scope.*

---

## 8. Fee accounting (AASB 15)

Stripe fees reduce net revenue but do not reduce gross customer charge. Correct treatment:

- **Gross revenue** = `Payment.amount` (what the customer paid).
- **Processing fees** = `StripeFeeLedger.feeAmountCents` (expense, not revenue reduction).
- **Net cash receipts** = gross − fees = what arrives in the bank.

`DailyRevenue.totalRevenue` already represents **gross**. Net is computed by subtracting aggregated Stripe fees — a column to add in P1 (`dailyStripeFees` on `DailyRevenue` or a separate aggregate).

---

## 9. Test plan for the reconciliation logic (P1)

Deferred tests, captured here so the contract is pinned:

- `tests/payments/reconciliation/happy-path.test.ts` — 10 bookings, 10 matching Stripe charges → zero unmatched.
- `tests/payments/reconciliation/missing-stripe.test.ts` — 10 Payments (SUCCEEDED) but only 9 in Stripe → 1 `UnmatchedTransaction(source=SYSTEM_LEDGER)`.
- `tests/payments/reconciliation/extra-stripe.test.ts` — Stripe shows a charge with no matching Payment → 1 `UnmatchedTransaction(source=STRIPE_CHARGE)`.
- `tests/payments/reconciliation/amount-mismatch.test.ts` — Payment is $49.00, Stripe says $49.50 → flagged.
- `tests/payments/reconciliation/payout-match.test.ts` — payout lump matched to 12 charges; bank CSV row matches payout.
- `tests/payments/reconciliation/invariant-bond.test.ts` — BondLedger row with `heldAmount ≠ captured + released + stillHeld` triggers invariant violation alert.

---

## 10. Phase 6 shadow-mode acceptance

Before the P1 reconciliation job can move to Phase 7 (controlled rollout), we require:

- **14 consecutive days** with `UnmatchedTransaction` (unresolved) count = 0 at EOD.
- One full month-end close completed cleanly, including BAS-ready GST export.
- CFO formal sign-off on `docs/payments/reconciliation-spec.md` + observed shadow-mode output.

---

## 11. Summary of what this document commits to

- **This run (P0)**: `StripeWebhookEvent` migration from §3.1 is produced as part of G1.
- **P1 (deferred)**: `PaymentEvent`, `StripeFeeLedger`, `UnmatchedTransaction` migrations + the reconciliation job (§6) + bank-statement ingest skeleton.
- **P2**: fee accounting column on `DailyRevenue` + AASB 15 daily accrual if CFO determines the simplified approach isn't acceptable.
