# Runbook — Chargeback / Dispute Response

**Purpose:** Respond to a `charge.dispute.created` event within Stripe's evidence-submission window (typically 7–21 days depending on card network).

**Audience:** Payments lead + customer-service lead.

**Severity:** P1 — financial loss + reputational risk.

---

## Stripe dispute lifecycle

```
charge.dispute.created
  → dispute.status = needs_response
  → submit evidence (Stripe dashboard or API)
  → dispute.status = under_review
  → dispute.status = won | lost
  → charge.dispute.closed webhook
```

Evidence submission window varies: Visa 20 days, Mastercard 15 days, Amex 30 days. **Target: respond within 5 business days** so Finance can review before submission.

## Triggers

- Webhook fires `charge.dispute.created` → our handler (after G2 lands):
  1. Sets `Payment.status = DISPUTED`.
  2. Creates `Incident(type=CHARGEBACK, paymentId=..., status=REPORTED)`.
  3. Sends in-app + email notification to all MANAGER and ADMIN users.
  4. Creates a `dispute-response` BullMQ job scheduled for 24h out (reminder).

- Manager dashboard surfaces `Incident(type=CHARGEBACK)` list.

## Immediate response (within 24 h)

### 1. Pull the facts

```sql
-- The payment
SELECT * FROM "Payment" WHERE id = '<payment-id>';

-- The booking
SELECT * FROM "Booking" WHERE id = (
  SELECT "bookingId" FROM "Payment" WHERE id = '<payment-id>'
);

-- All inspections for the vehicle in that window
SELECT i.* FROM "Inspection" i
JOIN "Booking" b ON b.id = i."bookingId"
JOIN "Payment" p ON p."bookingId" = b.id
WHERE p.id = '<payment-id>';

-- All communications with the customer
SELECT * FROM "CommunicationLog" WHERE "customerId" = (
  SELECT "customerId" FROM "Payment" WHERE id = '<payment-id>'
) ORDER BY "sentAt" DESC;
```

### 2. Classify the dispute

Read `Stripe.Dispute.reason` (from the event payload stored in `StripeWebhookEvent.payload`):

| Reason | Typical cause | Our defence |
|--------|---------------|-------------|
| `duplicate` | Customer believes they were charged twice | Pull all Payment rows for booking; if only one SUCCEEDED, submit receipt + booking confirmation. |
| `fraudulent` | Cardholder claims they didn't authorise | Submit rental agreement signature, licence photos (verified), booking-time IP + device fingerprint, delivery address match. |
| `product_not_received` | Customer says vehicle wasn't provided | Submit check-out inspection photos, customer signature, GPS telemetry if available. |
| `product_unacceptable` | Vehicle was defective | Submit pre-hire inspection, maintenance log, post-hire inspection, photos. |
| `subscription_canceled` | Not applicable (we don't do subscriptions). Flag for review. | — |
| `general` | Catch-all | Full package: booking, agreement, inspections, comms. |

### 3. Compile evidence packet

**For the P0 run**, evidence is compiled manually using the SQL queries above + manual document download. P1 adds `src/server/services/dispute-response.ts` which auto-compiles a PDF.

Required attachments in Stripe dispute response:

- **Customer signature** on rental agreement (PNG from `Booking.signatureUrl`).
- **Licence photos** (front + back from CustomerProfile, confirming ID match).
- **Pre-hire + post-hire inspection PDFs** (already sealed with TSA timestamp per `return.finalise`).
- **Proof of delivery** (delivery photo + timestamp if applicable).
- **Communication log** — automated booking confirmation email, reminder SMS, return notice.
- **Shipping address** = depot address (flag as "customer collected from our address").
- **Service documentation** = rental agreement text explaining damage / late fee / toll authorisation.

### 4. Submit via Stripe

```bash
stripe disputes update dp_XXX \
  --evidence[customer_signature]=file_abc \
  --evidence[receipt]=file_def \
  --evidence[service_documentation]=file_ghi \
  --evidence[uncategorized_text]="Customer booked scooter SCT-001 for 2026-04-10 to 2026-04-12. Full rental agreement signed digitally. Pre-hire and post-hire inspections conducted with customer present and signed. See attached."
```

Or via dashboard — https://dashboard.stripe.com/disputes/dp_XXX.

### 5. Track outcome

Dispute status updates arrive via `charge.dispute.updated` and `charge.dispute.closed` webhooks (P1 handler expansion). For P0, check dashboard daily.

On `won` — `Payment.status` → `SUCCEEDED`, Incident closed.
On `lost` — funds already debited; `Payment.status` → `REFUNDED` (effectively); customer balance updated.

## Do not

- **Do not refund** the original charge while a dispute is active. Stripe rejects this; double-debits the merchant.
- **Do not contact the customer** directly about the dispute outside of normal booking-related communication. Legal may advise "hostile dispute" procedures.
- **Do not delete** any booking or inspection record during the dispute — this is audit-critical.

## Escalation criteria

- If disputes/chargebacks in a rolling 30-day window exceed 1% of transactions, Stripe flags us ("Early warning"). Page CFO + Payments lead.
- 3% triggers Dispute Monitoring Program (fines per dispute + potential account termination).

Current baseline to be established in Phase 6 shadow mode.

## Post-resolution

- Write outcome + lessons into the Incident note (`IncidentNote`).
- If pattern emerges (same failure mode > 2 times in a quarter), open a P1 ticket to strengthen the product / checkout flow.
- Update this runbook with any new dispute reasons encountered.

## Fraud flagging

If the investigation reveals clear fraud:

- Flag `CustomerProfile.riskRating = HIGH` + `User.status = SUSPENDED`.
- Write `AuditLog` action = `customer.suspended_fraud`.
- Blacklist by licence number in `CustomerProfile.blacklistReason`.
- Do **not** share customer PII with other merchants without legal advice.
