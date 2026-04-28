# Payments — Test Traceability Matrix

Maps each scenario in the user's Section-3 test matrix to the test file that
exercises it, the gap(s) it covers, and its current status. Updated after
P0 + P1 + P2 + supplementary gap-register items (G19–G24) all landed.

## Legend

- ✅ Implemented + passing
- 🟡 Specified but deferred (spec-only — lives in a doc, not code)
- ⏳ Skeleton only (Playwright — needs seeded fixtures / Stripe test keys)

---

## 3.1 Happy path

| Scenario | File | Gaps | Status |
|----------|------|------|--------|
| Booking → confirm → check-in → refund → bond release | tests/e2e/booking-payment.spec.ts + check-in-damage.spec.ts | G15 | ⏳ |
| Stripe webhook success → capturable → refund sequence | tests/payments/happy-path.test.ts | | ✅ |
| All payment methods supported | — | | 🟡 P3 — CARD only today |
| All currencies / jurisdictions | — | | 🟡 — AUD only |

## 3.2 Failure & degraded

| Scenario | File | Gaps | Status |
|----------|------|------|--------|
| Gateway downstream handler 500 | tests/payments/gateway-failure.test.ts | G1, G15 | ✅ |
| Dedup insert failure (non-P2002) | tests/payments/gateway-failure.test.ts | G1 | ✅ |
| Gateway 5xx during capture → retry | tests/payments/capture-retry.test.ts | G8 | ✅ |
| Hard decline → FAILED | tests/payments/capture-pending-payments.test.ts, tests/payments/capture-retry.test.ts | G5, G8 | ✅ |
| Retry exhaustion → manager alert | tests/payments/capture-retry.test.ts | G8 | ✅ |
| Duplicate submission (confirmPayment) | — | G15 | 🟡 — requires integration DB |
| Webhook replay / duplicate event | tests/payments/webhook-replay.test.ts | G1 | ✅ |
| Network / DNS / TLS failures | scripts/chaos/stripe-flake.ts | G16 | ✅ (chaos harness) |
| Card expired / issuer unavailable | — | | 🟡 — needs real Stripe test mode |
| Database partition mid-tx | scripts/chaos/db-partition.ts | G16 | ✅ (chaos harness) |
| BondLedger invariant violation | Postgres CHECK constraints (migration 20260418230000) | G20 | ✅ (DB-level guarantee) |
| Production Stripe stub-mode | tests/payments/stub-guard.test.ts | G19 | ✅ |

## 3.3 Edge cases

| Scenario | File | Gaps | Status |
|----------|------|------|--------|
| Booking fee charged but booking never confirmed | tests/unit/webhooks/stripe.test.ts | | ✅ |
| Customer never arrives → NO_SHOW | tests/payments/no-show-detector.test.ts | G22 | ✅ |
| Payment succeeds at gateway, fails to record in DB | — | | 🟡 — compensation path deferred |
| Toll arriving after card removed (no stored PM) | tests/payments/capture-pending-payments.test.ts | G5, G6 | ✅ |
| Fine arriving after customer closed / bankrupt | — | | 🟡 |
| Damage claim disputed + payment plan | — | | 🟡 |
| Customer changes payment method mid-dispute | — | G6 | 🟡 |
| Leap-year / DST / timezone billing | — | | 🟡 |
| Toll admin fee applied to delayed recoveries | tests/payments/toll-admin-fee.test.ts | G10 | ✅ |
| Invoice aggregation across 180d window | tests/payments/invoice-generate.test.ts | G17 | ✅ |

## 3.4 Adversarial & fraud

| Scenario | File | Gaps | Status |
|----------|------|------|--------|
| Stolen card → cardholder disputes | tests/payments/chargeback-response.test.ts | G2, G12 | ✅ |
| Dispute evidence packet compilation | tests/payments/dispute-response.test.ts | G12 | ✅ |
| Friendly fraud / first-party chargeback | tests/payments/chargeback-response.test.ts (idempotent branch) | G2 | ✅ |
| PAN leak in audit/metrics/logs | tests/payments/stripe-customer.test.ts, tests/payments/dispute-response.test.ts | G13 | ✅ |
| Secret rotation audit trail | tests/payments/integration-audit.test.ts | G24 | ✅ |
| Sequential small-value probing | — | | 🟡 |
| Account takeover with PM swap | — | | 🟡 |
| Staff + customer collusion | — | | 🟡 P3 |

## 3.5 Load & performance

| Scenario | File | Gaps | Status |
|----------|------|------|--------|
| Peak booking surge (50 rps × 10m) | scripts/load/booking-surge.js | G16 | ✅ (k6 script) |
| Bulk toll ingest (10k rows) | scripts/load/toll-ingest.js | G16 | ✅ (k6 script) |
| Mass refund event | — | | 🟡 |
| Month-end recon | — | G3 | 🟡 (spec in reconciliation-spec.md) |

## 3.6 Recovery & disaster

| Scenario | File | Gaps | Status |
|----------|------|------|--------|
| Full DB restore consistency | — | | 🟡 Ops runbook |
| Gateway failover | — | | 🟡 |
| Region failover | — | | 🟡 |
| Reconciliation after extended outage | runbook-webhook-replay.md + tests/payments/stripe-reconcile.test.ts | G1, G3 | ✅ (runbook + recon job tested) |
| E-Toll scraper silent breakage detection | tests/payments/etoll-health.test.ts | G21 | ✅ |

## 3.7 Ongoing operations (new)

| Scenario | File | Gaps | Status |
|----------|------|------|--------|
| Dunning ladder progression | tests/payments/dunning-ladder.test.ts | G7 | ✅ |
| Stripe fee ledger population | tests/payments/stripe-reconcile.test.ts | G3 | ✅ |
| Unmatched transaction detection | tests/payments/stripe-reconcile.test.ts | G3 | ✅ |
| Metrics scrape endpoint | tests/payments/metrics.test.ts | G14 | ✅ |
| PaymentEvent append-only log | plumbed via writePaymentEvent helper (tested implicitly by capture-pending, capture-retry, webhook tests) | G9 | ✅ |
| No-show + fee + bond release | tests/payments/no-show-detector.test.ts | G22 | ✅ |
| Secret rotation audited | tests/payments/integration-audit.test.ts | G24 | ✅ |

---

## New code paths specifically covered

| File | What it verifies | Tests |
|------|-----------------|-------|
| tests/payments/webhook-replay.test.ts | G1 — StripeWebhookEvent PK dedup | 2 |
| tests/payments/chargeback-response.test.ts | G2 — Payment→DISPUTED, Incident, notify | 3 |
| tests/payments/capture-pending-payments.test.ts | G5 — 4 outcome branches + empty-set | 5 |
| tests/payments/capture-retry.test.ts | G8 — backoff retry + exhaustion | 6 |
| tests/payments/stripe-customer.test.ts | G6 — Customer + SetupIntent + PM | 5 |
| tests/payments/confirm-charge.test.ts | G4 — DamageCharge state machine | 6 |
| tests/payments/happy-path.test.ts | webhook sequence + audit log | 4 |
| tests/payments/gateway-failure.test.ts | G1 — downstream 500 + dedup insert failure | 2 |
| tests/payments/stripe-reconcile.test.ts | G3 — feeLedger + payout link + unmatched | 4 |
| tests/payments/dunning-ladder.test.ts | G7 — 5-stage progression | 5 |
| tests/payments/toll-admin-fee.test.ts | G10 — fee config + computation | 6 |
| tests/payments/invoice-generate.test.ts | G17 — weekly aggregation + dedup | 4 |
| tests/payments/metrics.test.ts | G14 — Prometheus text format | 6 |
| tests/payments/dispute-response.test.ts | G12 — evidence packet compilation | 3 |
| tests/payments/no-show-detector.test.ts | G22 — no-show transition + fee | 4 |
| tests/payments/etoll-health.test.ts | G21 — health alert + cooldown | 3 |
| tests/payments/stub-guard.test.ts | G19 — prod stub refusal | 4 |
| tests/payments/integration-audit.test.ts | G24 — secret rotation audit | 5 |
| tests/unit/webhooks/stripe.test.ts | pre-existing + expanded mocks for G1 | 7 |

**Total scenarios: 84 unique test cases across 19 files** (vitest runs each in node + jsdom projects, doubling the reported count).
