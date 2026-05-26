# Payments — External Integrations Inventory

**Status:** Phase 1 discovery artefact.
**Purpose:** Single-source-of-truth table of every external integration that touches money, with trust boundary, auth mode, failure modes observed in code, and current test harness.

---

## 1. Integration summary table

| # | Integration | Purpose | Direction | Trust boundary | Auth | File(s) |
|---|-------------|---------|-----------|----------------|------|---------|
| 1 | **Stripe API** | PaymentIntents, bond holds, refunds | Outbound HTTPS | Over public internet | Bearer secret key | [src/lib/stripe.ts](/home/vlad/scootering/src/lib/stripe.ts) |
| 2 | **Stripe webhooks** | Event delivery | Inbound HTTPS | Over public internet | HMAC-SHA256 signature | [src/app/api/webhooks/stripe/route.ts](/home/vlad/scootering/src/app/api/webhooks/stripe/route.ts) |
| 3 | **NSW E-Toll** | Toll activity ingest | Outbound Playwright | Public portal | Cookie session, scraped | [src/server/services/etoll.ts](/home/vlad/scootering/src/server/services/etoll.ts) |
| 4 | **Linkt (VIC/QLD)** | Toll activity ingest | Outbound (stub) | — | — | [src/server/services/linkt.ts](/home/vlad/scootering/src/server/services/linkt.ts) |
| 5 | **Twilio** | SMS notifications | Outbound HTTPS | Public internet | Account SID + auth token | [src/lib/sms.ts](/home/vlad/scootering/src/lib/sms.ts) (assumed) |
| 6 | **Resend** | Transactional email | Outbound HTTPS | Public internet | Bearer API key | [src/lib/email.ts](/home/vlad/scootering/src/lib/email.ts) (assumed) |
| 7 | **MinIO / S3** | Receipt / invoice PDF storage | Outbound (LAN or public) | VPC or public | S3 signature v4 | [src/lib/storage.ts](/home/vlad/scootering/src/lib/storage.ts) (assumed) |
| 8 | **Postgres** | System of record | Outbound (VPC) | Internal VPC | Password / IAM | via Prisma |
| 9 | **Redis** | BullMQ + session + availability cache | Outbound (VPC) | Internal VPC | Password (optional) | via ioredis |

Numbers 1–4 are the ones that can lose or duplicate money if they fail wrong; they get the detailed sections below. 5–9 are supporting and are called out only where a failure there corrupts a payment flow.

---

## 2. Stripe API (outbound)

### Configuration

- **Secret key** (`STRIPE_SECRET_KEY` env — credentials are environment-only; there is no in-app editor).
- **Publishable key** (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) — client-side only.
- **API version**: `2024-09-30.acacia` (pinned in `getStripeClient`).
- **Loader**: lazy `eval("require")` so webpack doesn't bundle the SDK; returns `null` if unconfigured → the rest of the code falls into **stub mode**.

### Functions exposed

| Function | Stripe call | Capture mode | Stub-mode behaviour |
|----------|-------------|--------------|---------------------|
| `createPaymentIntent` | `paymentIntents.create` | automatic | returns `pi_stub_<bookingId>` with status `succeeded` |
| `createBondHold` | `paymentIntents.create` | manual | returns `pi_bond_stub_<bookingId>` |
| `cancelPaymentIntent` | `paymentIntents.cancel` | — | no-op if id starts with `pi_stub_` or `pi_bond_stub_` |
| `constructWebhookEvent` | `webhooks.constructEvent` | — | returns `null` if no signature or webhook not configured |

### Observed failure modes

1. **Network timeout / 5xx.** Not currently retried. A `createPaymentIntent` failure inside `booking.create` surfaces as a tRPC error to the client; the Booking row is rolled back. Safe — no orphaned Booking.
2. **Signature verification failure on webhook.** Logged (warn), 400 returned. Stripe retries per its own schedule. No persistence of the event → we cannot audit historic signature failures [G1].
3. **Stub-mode silent success.** Without `STRIPE_SECRET_KEY`, `createPaymentIntent` returns `pi_stub_…` with `succeeded`. Any environment that goes live without the key will appear to capture payments but move no money. Guard: production env-var validation (Zod at startup — confirm present).
4. **Card decline / `requires_action`.** Current code maps only `succeeded` vs. `requires_confirmation`. 3DS / SCA flows (`requires_action`) are not handled end-to-end [G11].

### Trust boundary

- PAN never reaches our server — Stripe Elements posts direct to `api.stripe.com`. We store only `pi_…`, `ch_…`, later `cus_…` + `pm_…` tokens.
- PCI-DSS scope: **SAQ-A** (Stripe Elements hosted; no raw PAN transit, processing, or storage). Confirmed by file grep for PAN-shaped regex (none found).

### Secrets lifecycle

- Rotated by updating `STRIPE_SECRET_KEY` in the deployment environment and restarting — `integration-config.ts` reads `integration:*` keys straight from `process.env` (no DB row, no in-app editor).
- See the secret-rotation runbook for the full procedure.

### Test harness

- **Unit/integration**: `@/lib/stripe` is `vi.mock`'d per test; Stripe SDK never loaded. See [tests/unit/webhooks/stripe.test.ts](/home/vlad/scootering/tests/unit/webhooks/stripe.test.ts).
- **E2E (new in P0 run)**: real Stripe test mode with test cards (`4242…`, `4000 0027 6000 3184`, `4000 0000 0000 9995`). CI secret: `STRIPE_TEST_SECRET_KEY`.

---

## 3. Stripe webhooks (inbound)

### Endpoint

`POST /api/webhooks/stripe` — public, unauthenticated at the network layer; authenticated by signature.

### Handled events

| Event | Today | After P0 |
|-------|-------|---------|
| `payment_intent.succeeded` | Payment → SUCCEEDED, notification sent | unchanged, wrapped in dedup |
| `payment_intent.amount_capturable_updated` | BondLedger → HELD | unchanged, wrapped in dedup |
| `payment_intent.payment_failed` | Payment → FAILED, Booking → CANCELLED | unchanged, wrapped in dedup |
| `payment_intent.canceled` | BondLedger → RELEASED | unchanged, wrapped in dedup |
| `charge.refunded` | Payment → REFUNDED/PARTIALLY_REFUNDED, `recordRefund` | unchanged, wrapped in dedup |
| `charge.dispute.created` | Payment → DISPUTED (only) | **expanded**: create Incident(CHARGEBACK), notify managers, queue evidence [G2] |
| `charge.dispute.closed` | **not handled** | **new** in P1 — sync outcome back to Payment |
| `identity.verification_session.verified` | customerProfile.licenceVerifiedAt | unchanged |
| `identity.verification_session.requires_input` | log only | unchanged |

### Delivery guarantees (Stripe side)

- At-least-once delivery with exponential backoff up to 3 days.
- Duplicate events share the same `id` (evt_…). This is what makes dedup feasible.

### Observed failure modes

1. **Replay after our 500.** Stripe retries after our handler returns non-2xx. Handlers are idempotent *by shape* (updateMany, upsert), but we cannot prove a historic event was processed exactly once [G1].
2. **Clock skew.** `constructEvent` enforces a 5-minute tolerance by default. We don't override. A seriously skewed server would reject valid events; no alert on this today.
3. **Missing webhook secret.** Route returns 503. Stripe keeps retrying. If an operator accidentally rotates the key without updating `SystemSetting`, all events dead-letter silently on Stripe's side until the retry window expires.

### Trust boundary

- Inbound from Stripe IPs (no allowlist — we trust the signature).
- Signature secret (`whsec_…`) is the only authentication.
- No body size limit enforced beyond Next.js defaults (1MB) — sufficient for Stripe payloads.

### Test harness

- `tests/unit/webhooks/stripe.test.ts` constructs in-memory event objects and mocks `constructWebhookEvent`. No real signature verification exercised.
- After P0: `tests/payments/webhook-replay.test.ts` asserts dedup via `StripeWebhookEvent` table.
- Manual: `stripe trigger payment_intent.succeeded` via Stripe CLI against staging.

---

## 4. NSW E-Toll (outbound Playwright)

### Configuration

- `EtollAccount` table: one row per account (typically one per corporate depot). Stores username + encrypted password.
- Sync cadence: `SystemSetting.etoll.syncIntervalMinutes` (default 360 = every 6 hours).

### Flow

1. `jobs/etoll-sync.ts` enqueues repeat job per `EtollAccount` with `isActive = true`.
2. Worker calls `runEtollSync` in `etoll.ts`:
   a. `loginAndDownloadActivity` launches Playwright Chromium, fills Formik login form, downloads XLSX.
   b. `parseEtollWorkbook` reads XLSX, emits `EtollTripRow[]` (type=Trip only).
   c. `matchTripRow` resolves each row against an active Booking via rego OR `gpsTrackerId` (tag) matching + pickup/return time window.
   d. `upsertInfringementFromRow` writes an `Infringement` row idempotently keyed on `externalHash = SHA256(accountId|date|details|amount)`.

### Observed failure modes

1. **Portal DOM change.** Playwright selectors are brittle. Any NSW Transport UI update could silently break login or export. No monitoring today beyond job failure → Sentry.
2. **Rate limiting / lockout.** Repeated failed logins could lock the account. We have no backoff beyond the 6h cadence.
3. **Credential rotation.** Requires manual update via admin UI → `SystemSetting`.
4. **Duplicate ingestion.** Guarded by `externalHash` unique constraint. Replays are safe.
5. **Unmatched rows.** Routed to `EtollUnmatchedRow` for admin review. No auto-escalation if the backlog grows.
6. **Legal / ToS.** Scraping a government portal is a grey area. Checked at the top of risk register; legal sign-off required in Phase 2.

### Trust boundary

- Credentials stored encrypted in DB. Decrypted only in the job worker at sync time.
- Outbound from the worker IP — a persistent egress IP for the app server. NSW may block shared-cloud IPs.

### Test harness

- `tests/unit/trpc/router/etoll.test.ts` unit-tests the parser + matcher with fixture rows.
- No E2E test against the real portal (would be a compliance concern; also brittle).

---

## 5. Linkt (stub)

- File exists: [src/server/services/linkt.ts](/home/vlad/scootering/src/server/services/linkt.ts). Deferred P2 (G18).
- When implemented, inherits the same contract as etoll.ts: download + parse + match + upsert Infringement.

---

## 6. Twilio (SMS)

### Usage

- `sendNotification` with `channels: ["SMS"]` routes through `@/lib/sms`.
- Used for: booking confirmation, booking reminder (24h), return reminder, overdue escalation stages 1+2+3, debt reminder (if phone verified).

### Observed failure modes

1. **Invalid phone number.** Twilio returns 400; we log and continue. Notification row marked FAILED.
2. **Rate limiting / spend cap.** Could drop overdue / dispute notifications silently. No alert on consecutive failures.
3. **Regulatory (Australian SMS rules).** Must include opt-out. Confirm in compliance doc.

### Trust boundary

- Outbound over HTTPS, token auth.
- Phone numbers are PII — already redacted in logs.

---

## 7. Resend (email)

- Transactional via [emails/](/home/vlad/scootering/emails) React Email templates.
- Failure mode: bounce / deliverability → `Notification.status = FAILED`. No bounce webhook handler wired (possible P2 work).

---

## 8. MinIO / S3 (storage)

- Used for: inspection photos, rental agreement PDFs, invoice PDFs, receipts.
- Payment-critical files: invoice PDFs (Invoice.pdfUrl), receipt PDFs (Payment.receiptUrl).
- Failure mode: upload failure during `finalise` on ReturnAssessment → retry in memory; if persistently failing, ReturnAssessment remains DRAFT. No payment money moves until assessment is sealed (for damage), so this is safe.

---

## 9. Postgres

- System of record. Everything else is downstream.
- All payment-mutating operations use `prisma.$transaction` to ensure atomicity of Booking + Payment + BondLedger writes.
- **Known issue**: check-in transaction today combines DB writes with (eventual) Stripe capture calls in the same transaction scope. If we add inline Stripe calls, a rollback would still leave Stripe state inconsistent. G8's retry queue (P1) resolves this by moving the Stripe call outside the DB transaction and using the queue as the bridge.

---

## 10. Summary — where the blast radius is

Ranked by "can silently lose money if this integration fails badly":

1. **Stripe API** (outbound) — stub-mode in prod would be catastrophic. Guard with env-var validation. Captured in P0 work via G6 (Stripe Customer creation fails loudly if unconfigured).
2. **Stripe webhooks** (inbound) — missed events equal stuck PENDING Payments or unreleased bonds. G1 and the P1 reconciliation job (G3) compensate.
3. **NSW E-Toll** — silent portal breakage = customers never charged for tolls (no auto-capture today anyway; G5 makes this real).
4. **Postgres** — obvious. Already well-protected by Prisma transactions; audit-retention + PITR should be in place (confirm in compliance).
5. **Redis** — BullMQ outage pauses all scheduled jobs (dunning, overdue, bond release, reconciliation). Nothing loses money directly but everything slows.

Everything else (Twilio, Resend, S3, Linkt stub) is non-money-critical or deferred.
