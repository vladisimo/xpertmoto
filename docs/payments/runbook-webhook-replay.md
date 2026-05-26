# Runbook — Stripe Webhook Replay / Missed Event

**Purpose:** Diagnose and fix state drift caused by missed, duplicated, or failed Stripe webhook events.

**Audience:** On-call engineer.

**Severity:** P2 (ticket) unless a booking or bond is stuck — then P1.

---

## Symptoms

- Customer paid but Booking still `PENDING_PAYMENT`.
- BondLedger still `HELD` > 14 days after a successful bond auto-release capture attempt.
- `Payment.status = PENDING` after Stripe dashboard shows the charge succeeded.
- `StripeWebhookEvent` row count drops to zero for > 30 min (no events arriving).

## Pre-checks

### 1. Has Stripe stopped delivering?

```bash
# Check last event timestamp
psql "$DATABASE_URL" -c "
  SELECT MAX(\"receivedAt\") AS last_event
  FROM \"StripeWebhookEvent\";"
```

If last event > 30 min ago AND there was traffic on Stripe (check https://dashboard.stripe.com/events):

- Check firewall / WAF hasn't blocked `api.stripe.com` inbound path.
- Verify endpoint health: `curl -I https://<prod-host>/api/webhooks/stripe` → 405 expected (POST only).
- Check the `STRIPE_WEBHOOK_SECRET` env var is set; if missing, endpoint returns 503 and Stripe will retry.

### 2. Has a specific event failed?

```sql
SELECT id, type, status, "errorReason", attempts, "receivedAt"
FROM "StripeWebhookEvent"
WHERE status = 'FAILED'
ORDER BY "receivedAt" DESC
LIMIT 20;
```

## Replaying a single event

Stripe CLI:

```bash
# Get the event id from Stripe dashboard or the query above
stripe events resend evt_1Pabc123xyz --live
```

Or from Stripe dashboard → Developers → Events → [event] → "Resend".

Our handler is idempotent: the `StripeWebhookEvent` insert on `id` collides on replay; the handler sees `status=PROCESSED` and returns 200 immediately.

## Replaying missed events in a time window

If Stripe dashboard shows successful events that don't appear in our DB for a window (e.g. after a deploy outage):

```bash
# List missing event IDs via Stripe API
stripe events list --created "gte=1744000000" --limit 100 \
  --live --output id | sort > stripe_events.txt

# Pull our recorded IDs for the same window
psql "$DATABASE_URL" -At -c "
  SELECT id FROM \"StripeWebhookEvent\"
  WHERE \"receivedAt\" > to_timestamp(1744000000);" | sort > our_events.txt

# Diff and resend
comm -23 stripe_events.txt our_events.txt | while read -r id; do
  stripe events resend "$id" --live
  sleep 0.5
done
```

After replay, requery the diff; should be empty.

## Manually reconciling a stuck booking

If a Booking remains `PENDING_PAYMENT` despite successful Stripe PI:

### 1. Verify Stripe state

```bash
stripe payment_intents retrieve pi_XXXXX --live
# Check status = succeeded, latest_charge present
```

### 2. Check our Payment row

```sql
SELECT id, status, "stripePaymentIntentId", "stripeChargeId", "createdAt"
FROM "Payment"
WHERE "stripePaymentIntentId" = 'pi_XXXXX';
```

### 3. Fix via tRPC mutation (preferred over direct SQL)

Use admin UI → Booking detail → "Manual reconcile" (P1; for P0 use SQL below).

For P0 — direct SQL (prefer wrap in transaction + writeAudit):

```sql
BEGIN;
UPDATE "Payment"
SET status = 'SUCCEEDED',
    "stripeChargeId" = 'ch_XXXXX',
    "processedAt" = NOW(),
    notes = COALESCE(notes,'') || ' [manual reconcile 2026-04-18 by <engineer>]'
WHERE "stripePaymentIntentId" = 'pi_XXXXX' AND status = 'PENDING';

INSERT INTO "AuditLog" ("userId", action, entity, "entityId", status, path, method, "createdAt")
VALUES ('<engineer-user-id>', 'payment.manual_reconcile', 'Payment', '<paymentId>', 'SUCCESS',
        '/admin/runbook-webhook-replay', 'SQL', NOW());
COMMIT;
```

Then manually trigger `booking.confirmPayment` logic by re-running the allocation in the admin UI, OR use a one-off script that walks stuck PENDING_PAYMENT bookings with SUCCEEDED payments.

## Handler failure investigation

If `StripeWebhookEvent.status = 'FAILED'`:

1. Read `errorReason`.
2. Check Sentry for the full stack trace around `receivedAt`.
3. Common causes:
   - Schema drift (migration not applied in prod → column missing).
   - BondLedger upsert conflict (concurrent webhook + manual release).
   - Downstream service (Resend / Twilio) 5xx cascading back.
4. Fix the underlying bug, deploy, then resend event via `stripe events resend`.

## Escalation

- If > 50 events FAILED in a rolling 1h window → page Payments lead + CFO.
- If a customer is confirmed to have paid but not booked → refund (via `stripe refunds create`) before the end of business day, then follow up.

## Post-incident

- Add a test reproducing the failure mode to `tests/payments/`.
- Update this runbook with the new failure signature.
- Bump retry attempts counter tuning in `capture-pending-payments` if relevant.
