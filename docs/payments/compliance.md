# Payments — Compliance Gap Analysis

**Status:** Phase 2 discovery artefact.
**Purpose:** Where Scootering stands against every relevant standard / statute for Australian rental payments, with "must-fix-before-prod" items escalated back into the risk register.

Relevant regimes:

1. **PCI-DSS v4.0** — card data handling.
2. **Strong Customer Authentication / 3DS2** — EU (PSD2) optional for AU; called out for EU guests.
3. **Australian Privacy Principles (APPs 1–13)** — PII handling.
4. **Australian Consumer Law (ACL)** — refund, cancellation, transparent pricing.
5. **Goods and Services Tax Act 1999** + BAS — tax treatment and invoicing.
6. **Australian Accounting Standards (AASB 15 "Revenue from Contracts with Customers")** — revenue recognition.
7. **State rental regulations (QLD, NSW, VIC)** — bond handling, disclosure.
8. **Anti-Money Laundering / Counter-Terrorism Financing (AML/CTF)** — above reporting thresholds only.
9. **Sector-specific**: NSW Transport portal ToS (for E-Toll scraping).

---

## 1. PCI-DSS v4.0

**Target level**: **SAQ-A** — merchants who outsource all cardholder data handling to a validated third party, do not transmit PAN themselves, and host no payment form directly.

### Assessment

| Requirement | Status | Evidence |
|-------------|--------|----------|
| 1. PAN never touches our servers | ✅ | Stripe Elements / PaymentSheet posts direct to Stripe. Confirmed by grepping codebase for PAN regex patterns — zero matches. |
| 2. No local storage of card data | ✅ | `Payment` model stores only `stripePaymentIntentId`, `stripeChargeId`. No PAN, CVV, expiry columns. |
| 3. TLS 1.2+ on all endpoints | ✅ | Enforced by hosting (Next.js/Vercel or equivalent). Confirm in infra doc. |
| 4. Vulnerability management | ⚠️ | Dependabot / Renovate status unknown — confirm in SRE. |
| 5. Access control | ✅ | NextAuth v5 with RBAC; MFA for STAFF / MANAGER / ADMIN enforced per CLAUDE.md §F1 (verify actual implementation). |
| 6. Audit trails | ⚠️ | Partial — [G13]. tRPC mutations do not consistently write `AuditLog`. After P0 G13 lands, this is resolved. |
| 7. Test security systems | ⚠️ | Needs a scheduled external ASV scan — Phase 2 deferred to infra team. |
| 8. Maintain security policy | ⚠️ | `docs/payments/runbook-*.md` will cover incident response. Broader policy doc is out of scope. |

**Gaps requiring action before prod:**

- **G13** (P0, this run): audit + redaction plumbing closes Req. 6 gap.
- **Dependabot/Renovate confirmation** (Phase 2, non-code): SRE to confirm scanner status and report at Phase 2 gate.
- **ASV scan schedule** (Phase 2, non-code): Booked with external ASV quarterly.

**Attestation plan.** Once the above land, Scootering signs SAQ-A annually. Sample attestation template to be committed under `docs/payments/compliance/saq-a-template.md` (P1 follow-up).

### Prohibited data

- **CVV / CVC / CVV2 / CID / Track 1/2 / PIN** — confirmed never stored.
- Full PAN, partial PAN (first 6 + last 4 is acceptable if needed; not currently stored).

### Key rotation

- Stripe secret keys rotated via `SystemSetting` (admin UI). Audit missing [G24 in risk register].

---

## 2. SCA / 3DS2 (PSD2)

AU is **out of scope** for PSD2 SCA. However, any booking originating from an EU-issued card could trigger a Stripe-forced SCA challenge, which the client must complete via `next_action.use_stripe_sdk`.

**Gap [G11]**: our `confirmCardPayment` path treats `requires_action` as indistinguishable from failure. EU visitors would see a failed booking.

**Volume assessment.** Scootering targets domestic tourists + locals. EU inbound is ≤1% by estimation. Prioritised **P2**.

**Remediation** (P2, deferred): client-side Stripe SDK handles `requires_action`; confirmPayment retries after the customer completes the challenge. Test with Stripe test card `4000 0027 6000 3184`.

---

## 3. Australian Privacy Principles (APPs)

### Data held

| Category | Stored in | Sensitivity |
|----------|-----------|-------------|
| Email | User.email | PII |
| Phone | User.phone | PII |
| Date of birth | User.dateOfBirth | PII |
| Licence number + images | CustomerProfile.licenceNumber / licenceImageFront / licenceImageBack | **Sensitive identification PII** |
| Address | CustomerProfile.address etc. | PII |
| Emergency contact | CustomerProfile.emergencyContact* | PII (third party) |
| Payment tokens | Payment.stripe*Id | **Not PII** (opaque tokens), but correlatable — treat as PII |

### APP obligations and status

| APP | Obligation | Status | Action |
|-----|-----------|--------|--------|
| APP 1 | Open and transparent management of PII | ✅ | Privacy policy page exists (`(public)/terms/`). Verify content matches actuals. |
| APP 3 | Collection only when reasonably necessary | ✅ | Booking collects licence/DOB for regulatory reasons. |
| APP 5 | Notify individual at collection | ⚠️ | Confirm booking form discloses what's collected and why. |
| APP 6 | Use/disclosure for primary purpose only | ✅ | Secondary use (marketing) gated on `marketingOptIn`. |
| APP 8 | Cross-border disclosure | ⚠️ | Stripe processes data in the US. Must be disclosed in privacy policy. |
| APP 11 | Security of PII | ⚠️ | Encrypted at rest (DB-level TDE + application-level for secrets); in transit TLS. **Amounts not redacted in logs [G13]** — close before prod. |
| APP 12 | Access to PII | ⚠️ | Customer portal shows own data. **Full export (JSON)** not implemented — spec §F2. |
| APP 13 | Correction | ✅ | Profile page allows edits. |

**APP 11 Notifiable Data Breaches**: if a payment PII leak occurs above the "serious harm" threshold, we must notify OAIC and affected individuals within 30 days. The runbook [runbook-dispute-response.md](./runbook-dispute-response.md) includes the data-breach branch.

**Gap for this run**: **G13** (P0) — closes the APP 11 logging gap. Full export / deletion workflow (APP 12/13 corner cases) is a separate P1 ticket.

---

## 4. Australian Consumer Law (ACL)

Section 18 (misleading conduct), s.29 (false representations), s.60 (consumer guarantees for services).

### Obligations

1. **Transparent pricing**: all prices GST-inclusive, bond amounts clearly disclosed.
2. **Cancellation policy**: clearly stated, not buried.
3. **Consumer guarantees on services**: vehicle fit for purpose; refund / replacement if not.
4. **Unfair contract terms**: s.24. Bond capture terms must be reasonable and clearly acknowledged.

### Status

| Obligation | Status | Evidence |
|-----------|--------|----------|
| GST-inclusive prices | ✅ | `Booking.totalAmount` is GST-inclusive; `gstAmount = totalAmount / 11`. |
| Bond disclosure | ✅ | `Booking.bondAmount` shown at checkout step 5 (Review & Terms). |
| Cancellation policy | ✅ | Set in `SystemSetting`; rendered on step 5. |
| Damage-charge authorisation | ⚠️ | Customer signs digital rental agreement at checkout. Confirm that the signed text authorises bond capture for damages — **legal sign-off required** in Phase 2. |
| Refund within reasonable timeframe | ⚠️ | `bond-auto-release` fires at 14d — confirm that meets "reasonable". |

### Gap

- Damage authorisation language in the rental agreement template (`emails/` or `public/documents/`) must be explicit about bond capture, late-fee accrual, and infringement nomination. **Legal to review during Phase 2.**

---

## 5. GST Act + BAS

### Obligations

- All prices must be GST-inclusive (advertised + invoiced).
- Tax invoices required for amounts ≥ A$82.50.
- Tax invoice must include: supplier name + ABN, date, description, amount, GST amount, "tax invoice" label.
- BAS lodgement: monthly if GST turnover ≥ A$20M (Scootering is below threshold → quarterly expected).

### Status

| Requirement | Status | Evidence |
|------------|--------|----------|
| GST-inclusive pricing | ✅ | See ACL section. |
| `gstAmount = totalAmount / 11` | ✅ | Confirmed in booking.ts quote logic. |
| ABN on invoice | ⚠️ | Invoice PDF template must include ABN — verify in `emails/` / PDF renderer. |
| "Tax Invoice" heading | ⚠️ | Verify in PDF template. |
| Quarterly GST summary for BAS | ⚠️ | `admin.financeGst` query exists; manual export. BAS CSV export format confirmation with accountant required. |

### Gap

- Confirm invoice PDF template; if missing ABN/heading, fix as part of Phase 4 P1 invoice work (G17).

---

## 6. Revenue recognition (AASB 15)

### Current approach (inferred from code)

- `DailyRevenue.bookingRevenue` is populated by `revenue-reconcile` from `Booking.status` transitions (filtered to COMPLETED / RETURNED with actual return time).
- Payments are recorded at capture (`Payment.status = SUCCEEDED`).

### AASB 15 five-step

1. Identify the contract → Booking CONFIRMED.
2. Identify performance obligations → provide vehicle for the hire period.
3. Determine transaction price → `Booking.totalAmount`.
4. Allocate transaction price → whole booking = one performance obligation (no package allocation needed).
5. Recognise revenue as/when performance obligation is satisfied → **over the hire period** (daily straight-line is conservative and simplest).

**Mismatch observed**: code recognises revenue at `Booking.status = RETURNED`. Under AASB 15, revenue should be accrued *daily* over the hire period. For bookings spanning a reporting period boundary (e.g. a 30-day hire that crosses 30 June EOFY), the code under-recognises revenue in the first period.

### Materiality

For hire periods ≤ 1 month this is ≤ A$1,500 per affected booking per reporting period. Low materiality unless a single hire spans two fiscal years — then it becomes a year-end adjustment manually made by the accountant.

### Recommendation

- **Phase 2 action (non-code)**: CFO/accountant confirms whether the simplified "recognise at return" approach is acceptable given materiality.
- **If not acceptable**: P1 work item to add a daily revenue accrual path (splits each booking into per-day `DailyRevenue` contributions).

---

## 7. State bond / rental regulations

Scootering depots operate in NSW (Byron Bay) and QLD (Gold Coast, Noosa) as of this writing.

### QLD — Motor Vehicle Traders (Rental) Act 1989 / Transport Operations

- No statutory maximum bond amount, but must be "reasonable and proportionate".
- Must be returned within 14 days of return of vehicle (aligns with `bond-auto-release`).
- Damage disputes: consumer may apply to QCAT.

### NSW — Motor Dealers and Repairers Act 2013 / Fair Trading

- Similar: reasonable bond, returned within reasonable time.
- Damage claims: NCAT.

### Obligations

- Bond amount clearly disclosed pre-contract → ✅.
- Bond deductions itemised → `BondLedger.deductions` JSON is the audit trail, but customer-facing itemisation (in email + return receipt) must be clear — confirm in P1 notification template review.

---

## 8. AML/CTF

- Scootering does not provide "designated services" under AML/CTF Act 2006 (rental, not financial services).
- No AUSTRAC obligations triggered.
- Standard fraud-detection still required (G15 test scenarios cover stolen-card / first-party fraud).

---

## 9. NSW E-Toll portal scraping — ToS

**Risk [G21]**: Playwright scraping of `myetoll.transport.nsw.gov.au` may breach the portal ToS.

### Assessment

- We act on behalf of the account holder (Scootering corporate toll account), with stored credentials explicitly provided for this purpose.
- We do not scrape third-party accounts or redistribute the raw data.
- A legal review should confirm the portal ToS permits authorised agent access via automated means.

### Mitigation

- Phase 2 legal sign-off on the scraping approach + fallback (API if available, email export parsing otherwise).
- If ToS-breaching, migrate to email export parsing (NSW E-Toll emails monthly statements — acceptable fallback).

---

## 10. Sign-offs required before production

Named stakeholders must provide formal sign-off (PR approval, email, or signed attestation) on the items below:

| Reviewer | Artefact | Scope |
|----------|----------|-------|
| CISO / security lead | `compliance.md` §1 PCI-DSS attestation | Confirm SAQ-A eligibility, G13 closure |
| Privacy officer | `compliance.md` §3 APPs | Confirm amount redaction, export/delete workflow P1 slated |
| Legal counsel | `compliance.md` §4 ACL + §9 E-Toll ToS + rental agreement authorisation language | Confirm damage-capture authorisation is enforceable |
| CFO | `compliance.md` §5 GST + §6 Revenue recognition | Confirm BAS export format + AASB 15 approach |
| Exec sponsor (CTO) | Full doc | Gate review for Phase 2 |

---

## 11. Summary — pre-prod must-fix

Items that *cannot* ship to production without resolution:

1. **G13** (P0, this run) — audit + amount redaction, closes APP 11 + PCI-DSS Req. 6.
2. **Invoice PDF ABN/heading** — verify + fix in current PDF renderer.
3. **Rental agreement damage-authorisation language** — legal review → amend template.
4. **E-Toll scraping legal sign-off** — may require fallback to email parsing if ToS-problematic.
5. **Privacy policy updated** to disclose Stripe US data processing (APP 8).

Items that *should* ship but can be P1 / P2:

- G3 scheduled reconciliation
- G7 dunning ladder
- G11 3DS2 for EU cards
- G14 Prometheus metrics
- Full customer data export / deletion (APP 12/13 corner cases)
