# Runbook — Payments Rollback

**Purpose:** Back out the P0 payment changes if post-deploy telemetry shows payment failure spike, bond-capture inconsistency, or reconciliation variance.

**Audience:** On-call engineer + Payments lead.

**Severity:** P1 (paging).

---

## Triggers — when to run this runbook

Invoke if any of:

- `stripe_webhook_total{outcome="error"}` > 5 in a 5-minute window (P1 metric G14; for P0 use SQL: `SELECT COUNT(*) FROM "AuditLog" WHERE action='webhooks.stripe' AND status='FAILURE' AND "createdAt" > NOW() - INTERVAL '5 minutes'` > 5).
- Any single BondLedger row with `capturedAmount + releasedAmount > heldAmount` (invariant violation; query in §6).
- `capture-pending-payments` DLQ depth > 50 within 30 min of deploy.
- Customer-reported "charged twice" reports > 2 in 1 hour.
- Finance variance report flags > A$500 discrepancy in first 24h.

## Pre-checks (2 min)

```bash
# 1. Confirm deploy id matches recent Payments release
gh release view --repo vladisimo/xpertmoto | head -10

# 2. Pull last hour of payment errors
psql "$DATABASE_URL" -c "
  SELECT id, action, status, \"errorCode\", \"createdAt\"
  FROM \"AuditLog\"
  WHERE action LIKE 'webhooks.stripe' OR action LIKE 'payment%'
    AND status IN ('FAILURE', 'DENIED')
    AND \"createdAt\" > NOW() - INTERVAL '1 hour'
  ORDER BY \"createdAt\" DESC LIMIT 50;"

# 3. Check for payment duplicates
psql "$DATABASE_URL" -c "
  SELECT \"stripePaymentIntentId\", COUNT(*)
  FROM \"Payment\"
  WHERE \"createdAt\" > NOW() - INTERVAL '1 hour'
    AND \"stripePaymentIntentId\" IS NOT NULL
  GROUP BY \"stripePaymentIntentId\"
  HAVING COUNT(*) > 1;"
```

If the duplicate-PI query returns rows → **rollback immediately**, escalate to Payments lead + CFO.

## Rollback procedure

### Option A — Feature-flag rollback (preferred)

All P0 changes are gated by `FeatureFlag.paymentsV2Enabled`. Disable via admin UI:

1. Admin → System → Feature Flags.
2. Toggle `paymentsV2Enabled` → **off**.
3. Save (writes `SystemSetting.feature_flag:paymentsV2Enabled=false` + audit log).
4. Wait ~60s for `integration-config` 5s cache TTL + request flush.
5. Re-run the payment-error SQL from pre-checks; confirm count returns to baseline.

Flag-off behaviour:
- `capture-pending-payments` job no-ops (checks flag at start of each tick).
- `return.confirmCharge` tRPC returns `FEATURE_DISABLED`.
- Webhook handler still persists `StripeWebhookEvent` rows (insert-only; harmless) but skips dispute-incident creation.

### Option B — Deploy-level rollback

If the flag is unresponsive or the bug is in code that runs regardless of flag:

1. `gh workflow run deploy.yml -f ref=<last-known-good-sha>` or equivalent.
2. Wait for deploy to complete (check /api/health).
3. Verify error rate drops.

### Option C — Partial rollback via BullMQ pause

If only `capture-pending-payments` is misbehaving:

```bash
# Pause the job without touching code
redis-cli -u "$REDIS_URL" "XGROUP SETID capture-pending-payments __paused $"
```

Or via the admin job-control UI (if available).

## Post-rollback verification

1. Customer-facing booking flow works (test a new booking through to payment confirmation).
2. Check-in produces Payment rows (even if PENDING, as in pre-P0 state).
3. No new duplicate PIs for 30 min.
4. Sentry error rate returns to baseline.

## Follow-up

- Open post-mortem ticket: Payments/POST-MORTEM-YYYY-MM-DD.
- Write root cause + remediation in risk register.
- Add regression test under `tests/payments/` covering the failure mode.
- Do **not** re-enable the flag until post-mortem is reviewed at the next payments working group.

## Data integrity repair (if needed)

If duplicate Payment rows were created:

```sql
BEGIN;
-- Identify duplicates (keep oldest by id lexicographic — cuid is time-ordered)
WITH dupes AS (
  SELECT "id", "stripePaymentIntentId",
         ROW_NUMBER() OVER (PARTITION BY "stripePaymentIntentId" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "Payment"
  WHERE "stripePaymentIntentId" IS NOT NULL
    AND "createdAt" > '2026-04-18 00:00:00'
)
-- Do NOT DELETE; mark the extras as MANUAL_CREDIT negative amounts for audit
UPDATE "Payment" SET "notes" = COALESCE("notes",'') || ' [SUPERSEDED by rollback 2026-04-18]'
WHERE "id" IN (SELECT "id" FROM dupes WHERE rn > 1);
COMMIT;
```

Never `DELETE FROM "Payment"` in prod. Always soft-mark + audit.
