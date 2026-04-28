# Runbook — Reconciliation Variance

**Purpose:** Investigate and resolve any variance between Scootering's ledger, Stripe, and the bank statement.

**Audience:** Finance + Payments lead.

**Severity:** P1 if variance > A$100, P0 if > A$1,000 or pattern suggests systemic issue.

---

## When to run

- Daily variance report (Phase 6 shadow mode → daily in prod): `npm run reconcile:variance --date=YYYY-MM-DD`.
- Admin dashboard card "Unmatched transactions" shows count > 0.
- Month-end close reveals gross/net mismatch.

## Reports referenced

| Report | Source | Cadence |
|--------|--------|---------|
| Daily variance | `scripts/reconcile-variance.ts` (to be built P1) | Daily 01:00 |
| Unmatched aging | `admin.financeReconciliation` tRPC query + `UnmatchedTransaction` table | Real-time |
| Stripe payout reconciliation | Stripe dashboard → Payouts | Daily |

## Triage flow

### Step 1 — Classify the variance

```sql
-- DB-side payment total for the day
SELECT SUM(amount) AS db_total
FROM "Payment"
WHERE status = 'SUCCEEDED'
  AND "createdAt"::date = '2026-04-18';

-- Stripe-side total (run Stripe CLI)
-- stripe balance_transactions list --created 'gte=1744848000&lte=1744934400' --type charge
```

Compare to `DailyRevenue.totalRevenue` for that date + depot. Expected: `DB payments - refunds ≈ DailyRevenue.totalRevenue`.

### Step 2 — Identify the category

| Variance type | Likely cause | Next step |
|--------------|--------------|-----------|
| DB > Stripe | Payment marked SUCCEEDED without real Stripe capture (e.g. old stub-mode row, manual reconcile with wrong id) | Query: `SELECT * FROM "Payment" WHERE "stripeChargeId" IS NULL AND status = 'SUCCEEDED'` |
| Stripe > DB | Charge in Stripe with no matching Payment row — likely webhook missed | See [runbook-webhook-replay.md](./runbook-webhook-replay.md) §"Replaying missed events" |
| Amount mismatch | FX, tip adjustment, Stripe fee applied differently | Check `StripeFeeLedger` (P1) or manual balance_transaction inspection |
| Bond not settled | BondLedger still HELD but Stripe says captured | `SELECT * FROM "BondLedger" WHERE status = 'HELD' AND "stripePaymentIntentId" IS NOT NULL` — check Stripe PI status for each |

### Step 3 — Resolve each `UnmatchedTransaction`

(Pertinent once P1 reconciliation job lands; for P0 use SQL equivalent.)

```sql
SELECT * FROM "UnmatchedTransaction"
WHERE "resolvedAt" IS NULL
ORDER BY "occurredAt" DESC;
```

For each row:

1. Read `reason` + `payload`.
2. Investigate (match to a Payment or Stripe charge manually).
3. Apply fix:
   - If a Payment needs to be created (Stripe charge with no DB row): create it via direct SQL + writeAudit + mark row resolved.
   - If a Payment needs updating: update + audit + mark row resolved.
   - If the Stripe charge is genuinely unexpected (e.g. staff tested something): investigate with staff, refund if needed.
4. Resolve:

```sql
UPDATE "UnmatchedTransaction"
SET "resolvedAt" = NOW(),
    "resolvedById" = '<engineer-user-id>',
    "resolvedNote" = 'Matched to Payment <id>. Cause: missed webhook on 2026-04-17 (Redis outage window). Resent via Stripe CLI.'
WHERE id = '<unmatched-id>';
```

## Bond invariant breaches

Invariant: `heldAmount = capturedAmount + releasedAmount + stillHeldPortion`, with `stillHeldPortion = 0` in terminal states.

Query breaches:

```sql
SELECT bl.id, bl."bookingId", bl.status,
       bl."heldAmount", bl."capturedAmount", bl."releasedAmount",
       (bl."heldAmount" - bl."capturedAmount" - bl."releasedAmount") AS still_held
FROM "BondLedger" bl
WHERE (bl.status IN ('FULLY_CAPTURED','RELEASED')
       AND bl."heldAmount" <> bl."capturedAmount" + bl."releasedAmount")
   OR bl."capturedAmount" + bl."releasedAmount" > bl."heldAmount";
```

If any row returns:

1. **Stop** — do not auto-fix.
2. Pull the booking, all Payments with `type IN (DAMAGE_CHARGE, BOND_RELEASE, BOND_CAPTURE)` for the booking.
3. Pull Stripe PI status (`stripe payment_intents retrieve pi_...`).
4. Reconstruct timeline; determine which side is wrong.
5. Apply fix in a transaction with writeAudit; add `deductions` JSON entry explaining the manual correction.

## Stripe fee reconciliation

Once P1 `StripeFeeLedger` lands:

```sql
-- Gross for day
SELECT SUM(amount) AS gross FROM "Payment"
WHERE status = 'SUCCEEDED' AND "createdAt"::date = '2026-04-18';

-- Stripe fees for the same day
SELECT SUM("feeAmountCents") / 100.0 AS fees FROM "StripeFeeLedger"
WHERE "balanceTxnCreatedAt"::date = '2026-04-18';

-- Net (should match bank deposit)
SELECT gross - fees AS net FROM <above>;
```

Compare to bank statement row for Stripe payout — should match within rounding.

## Month-end close

Checklist (Finance):

- [ ] All `UnmatchedTransaction` resolved for the month.
- [ ] `DailyRevenue` rebuilt (`npm run jobs:revenue-reconcile --backfill 31`).
- [ ] GST summary query executed: `admin.financeGst` with month range.
- [ ] Stripe payout schedule reconciled against bank.
- [ ] Credit notes reviewed (`SELECT * FROM "CreditNote" WHERE "createdAt" BETWEEN ...`).
- [ ] Bond capture exceptions reviewed.
- [ ] Variance report signed off by CFO.

## Red flags (page CFO)

- Variance > A$1,000 on any single day.
- Unmatched count growing day-over-day for 3+ consecutive days.
- Same customer's payments appearing unmatched repeatedly.
- Bond `capturedAmount + releasedAmount > heldAmount` anywhere (invariant breach).
- Stripe fee rate unexpectedly changes (signal of Stripe account tier change).

## Post-resolution

- Document root cause in a post-mortem ticket.
- Add regression test under `tests/payments/reconciliation/` covering the scenario.
- Consider whether a monitoring alert should fire earlier next time (add to G14 P1 scope).
