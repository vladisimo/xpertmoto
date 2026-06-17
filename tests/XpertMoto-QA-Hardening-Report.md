# XpertMoto — Booking Front-End QA & Hardening Report

**Target:** https://xpertmoto.dfortix.ai (Next.js / Stripe sandbox)
**Account tested:** `test@test.com` (CUSTOMER role)
**Date:** 16 June 2026
**Method:** Automated end-to-end testing with Playwright (headless Chromium) driving the real
site, plus an axe-core accessibility sweep and HTTP/header inspection. Evidence (screenshots,
network/console logs, structured JSON) is under `artifacts/`.

---

## 1. Executive summary

The core booking product is **functional and the money math is correct**. I completed the full
lifecycle end-to-end against the Stripe sandbox:

- **Create** bookings across **one day, a few days, and many days** — all reached status
  `CONFIRMED` with correct, GST-inclusive pricing.
- **Modify** a confirmed booking via **"Extend return date"** — reprices correctly and charges the
  card on file.
- **Cancel** a booking — reason-gated, shows the correct refund tier, and logs the action.

The UI is clean, fully responsive (no horizontal overflow at mobile/tablet/desktop), has no broken
links or images, and a working 404 page. Onboarding/KYC is genuinely robust — the identity step runs
**server-side document verification** that correctly rejects non-licence images.

However, several issues materially affect trust, conversion, accessibility, and security hardening.
The most important: a **pre-hydration login submit leaks the password into the URL**, an **expired
session is handled so poorly it breaks checkout and hangs the dashboard**, **licence eligibility is
only validated at the very last step**, the **payment step spawns large numbers of orphaned
"Pending payment" bookings**, and there is **no self-service modify beyond extending the end date**.

> ⚠️ **Testing artifact:** debugging the payment step created **hundreds of "Pending payment"
> bookings** plus a handful of `CONFIRMED`/`Cancelled` ones on the test account (see §9). These were
> left in place per your instruction. They double as evidence for finding **H-4**.

---

## 2. What works (verified)

| Area | Result |
|---|---|
| Login (email/password → tRPC `auth.preauth` → NextAuth credentials) | ✅ Works |
| Onboarding KYC: details → licence type → ID upload → policy accept → e-signature | ✅ Works; ID step has real ML doc verification |
| Create 1-day booking (Jun 18→19) | ✅ `CONFIRMED` — `SCT-20260616-YNAQ3D`, pay-now $46.50 |
| Create few-day booking (Jun 23→26, 3 d) | ✅ `CONFIRMED` — `SCT-20260616-FP8776`, pay-now $139.50 |
| Create many-day booking (Jun 24→Jul 8, 14 d, crosses month) | ✅ `CONFIRMED` — `SCT-20260616-NNWQBA`, pay-now $483.00 |
| Pricing math (rate × days + insurance, deposit, GST, bond hold) | ✅ Consistent (see §4 detail) |
| Modify — extend return date (Jul 7→9) | ✅ +2 days, +$162, new total $243, balance $196.50 to card on file |
| Cancel (pending → cancelled, reason + refund tier + activity log) | ✅ Works |
| Stripe sandbox payment (rental PaymentIntent + $300 bond hold) | ✅ Works |
| Responsive layout (390 / 820 / 1440 px) | ✅ No horizontal overflow on home/booking/fleet/pricing |
| Broken links / images / 404 page | ✅ None broken; 404 returns 404 |
| Security headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HttpOnly cookie) | ✅ Present |
| Business rules: Sundays closed, 2-hour prep window, past dates disabled, calendar availability colour-coding | ✅ Enforced |

**Pricing verified (GST-inclusive, LAMS @ $69/day, Standard insurance $12/day):**

| Duration | Rental | Insurance | Total | Pay now (deposit + insurance) | Pay at pickup |
|---|---|---|---|---|---|
| 1 day | $69 | $12 | **$81** | $34.50 + $12 = **$46.50** | $34.50 |
| 3 days | $207 | $36 | **$243** | $103.50 + $36 = **$139.50** | $103.50 |
| 14 days | first-week $483 | (in weekly charge) | weekly recurring | **$483.00** | recurring on saved card |

Long hires (≥ 1 week) switch to a **weekly-recurring** billing model ("Recurring charges follow on
the saved card") rather than a single charge — worth documenting clearly for customers.

---

## 3. Severity legend

- **Critical** — security exposure or data loss.
- **High** — blocks/!corrupts a core flow, or strongly harms trust/conversion.
- **Medium** — notable correctness, UX, a11y, or hardening gap.
- **Low** — polish / minor inconsistency.

---

## 4. Findings

### 🔴 C-1 (Critical) — Login leaks email + password into the URL before hydration
**What:** On `/login`, if the form is submitted before the page's JavaScript hydrates (slow network,
fast typist, or an automated/assistive client), the `<form>` falls back to a **native GET** submit.
The browser navigates to:
```
https://xpertmoto.dfortix.ai/login?email=you@example.com&password=<plaintext>
```
**Impact:** The password is exposed in browser history, the `Referer` header, any proxy/CDN/server
access logs, and analytics. This is a real credential-exposure vector.
**Repro:** Load `/login`, immediately fill and submit before hydration completes (reproduced
reliably in automation). Evidence: `artifacts/login/` debug run showed the URL becoming
`/login?email=…&password=…`.
**Fix:** Add `method="POST"` and an `onSubmit` `preventDefault` that is attached server-rendered, or
disable the submit button until hydrated, or make the form a server action. Never allow the native
GET fallback to carry credentials.

### 🟠 H-2 (High) — Expired session breaks checkout and hangs the dashboard
**What:** The NextAuth session token is short-lived. When it expires:
- `/dashboard` issues `session.whoAmI` → **HTTP 403**, and the page sits on **"Loading…" forever**
  (no redirect to login, no "session expired" message).
- The **payment step malfunctions**: clicking "Pay & confirm" re-creates the booking (`booking.create`
  fires repeatedly), shows a misleading **"Your mobile phone number is invalid."** error, never calls
  `booking.confirmPayment`, and the card form reverts to "Preparing your payment…".

With a **fresh** session the identical flow completes instantly (`booking.confirmPayment` → status
`CONFIRMED`). So the failures above are entirely a stale-session symptom that surfaces as confusing,
unrelated errors.
**Impact:** A user who leaves the tab open, or whose session lapses mid-checkout, cannot pay and gets
no actionable feedback; the dashboard appears permanently broken.
**Fix:** Treat 401/403 from `whoAmI`/tRPC as "session expired" → redirect to login (preserving
`callbackUrl`) and surface a clear toast. Refresh/extend the session during active checkout. Replace
the indefinite "Loading…" with an error+retry state. Make the payment handler fail loudly on auth
errors instead of re-creating the booking.

### 🟠 H-3 (High) — Licence eligibility is only checked at the final payment step
**What:** A car-only licence (class **C**) is allowed to select a motorcycle category, pick a
vehicle, add extras, review, and reach **step 6 (Payment)** — only there does it fail:
> "LAMS Motorcycle requires a R licence or higher — your C licence doesn't cover this category."
**Impact:** The customer completes five steps and enters card details before being told they're
ineligible. High-friction, likely abandonment.
**Fix:** Validate licence class against the chosen category at **step 1 (category selection)** or at
the latest **step 4 (details)** — and surface eligible categories up front. Evidence:
`artifacts/book/005-reach-s6-payment.png`.

### 🟠 H-4 (High) — Payment step creates many orphaned "Pending payment" bookings
**What:** Each visit/refresh of step 6 fires `booking.create` — frequently **multiple times per
visit**. Bookings are created in `Pending payment` state before payment and are never cleaned up if
payment doesn't finish. During testing the account accumulated **hundreds** of identical
`Pending payment` bookings.
**Impact:** Data bloat, skewed reporting/inventory holds, confusing "My bookings" list, possible
availability locking.
**Fix:** Create the booking/PaymentIntent **once** per checkout (idempotency key; reuse the draft on
re-render). Auto-expire/garbage-collect abandoned `Pending payment` drafts. Debounce `booking.create`.
Evidence: `artifacts/book/` network logs show repeated `booking.create`; bookings list returns ~500 rows.

### 🟡 M-5 (Medium) — No self-service modify other than "Extend return date"
**What:** A `CONFIRMED` booking exposes only **Extend return date** + **Cancel**. A `Pending payment`
booking exposes only **Cancel**. There is no way to **shorten/shift dates, change pickup time, change
vehicle category, or change add-ons/insurance** after booking — you must cancel and rebook.
**Impact:** You explicitly asked to "modify bookings"; today the only true modification is extending
the end date. Common changes force a cancel+rebook (and a fresh deposit / refund cycle).
**Fix:** Add a "Change booking" flow (dates/time/category/extras) with delta repricing, mirroring the
existing extend pattern. Evidence: `artifacts/manage/booking-detail.json`, `confirmed-detail.json`.

### 🟡 M-6 (Medium) — Fleet vehicle specs are placeholder/incorrect
**What:** On step 2 every vehicle shows **"Engine 660cc"** and **"Km 0"** regardless of model — e.g.
a *Honda CB125E* (125cc) and a *Yamaha NMAX155* (155cc) both display 660cc / 0 km.
**Impact:** Inaccurate specs undermine trust and can mislead licence/eligibility decisions.
**Fix:** Populate real engine capacity and odometer per vehicle (or hide the field until populated).
Evidence: `artifacts/map/002-step2.png`.

### 🟡 M-7 (Medium) — Default insurance is the paid "Standard" tier, not the free "Basic"
**What:** The insurance list presents **Basic — "Included" ($3,000 excess)** as the free option, yet
every quote defaults to **Standard insurance ($12/day, $1,500 excess)** and charges it (e.g. the
1-day total is $81 = $69 + $12, not $69). Customers may not realise they're opting into a paid tier
or that a free tier exists.
**Impact:** Customers likely overpay by default; arguably a dark-pattern/billing-clarity risk.
**Fix:** Either default to the free Basic tier, or make the pre-selected paid tier unmistakable
(highlighted selection + "you can switch to the included cover"). Verify which tier is actually
pre-selected vs merely shown. Evidence: `artifacts/map/` step-3 quote screenshots.

### 🟡 M-8 (Medium) — Analytics & monitoring endpoints erroring on every page
**What:** Every page load produces:
- `404` on `https://us-assets.i.posthog.com/array/phx_…/config.js` and `…/config` (PostHog config),
- intermittent `500` on `/monitoring` (Sentry tunnel).
**Impact:** Product analytics and/or error monitoring are likely **not recording correctly** — you
may be flying blind on real-user behaviour and JS errors. Also console noise on every page.
**Fix:** Correct the PostHog asset host/key configuration; investigate the Sentry `/monitoring` 500.
Evidence: `artifacts/audit/audit-results.json` (15× each across pages).

### 🟡 M-9 (Medium) — Accessibility (WCAG) violations across the site
axe-core (serious/critical highlights, aggregated across 14 pages):

| Rule | Impact | Pages | Nodes | Note |
|---|---|---|---|---|
| `aria-prohibited-attr` | serious | 12 | **405** | ARIA attributes not allowed for the element's role (shared component) |
| `color-contrast` | serious | 2 | 41 | Text below WCAG AA contrast |
| `region` / `landmark-*` | moderate | 12–14 | 38/12 | Content outside landmarks; non-unique landmarks |
| `label` | **critical** | 1 | 4 | Form inputs without programmatic labels |
| `button-name` | **critical** | 1 | 2 | Buttons with no discernible text (icon-only) |
| `aria-valid-attr-value` | **critical** | 2 | 2 | Invalid ARIA attribute values |
| `page-has-heading-one` / `heading-order` | moderate | 2–3 | — | `/booking` & `/login` have **no `<h1>`**; heading levels skip |

**Fix:** Remove disallowed ARIA attrs from the shared component (biggest win — 405 nodes), add
`aria-label`/text to icon buttons, label all inputs, fix contrast, add a single `<h1>` per page
(notably `/booking`, `/login`), and wrap content in `<main>`/landmarks.

### 🟡 M-10 (Medium) — Content Security Policy is Report-Only (not enforced)
**What:** Responses send `Content-Security-Policy-Report-Only` but **no enforcing
`Content-Security-Policy`** header. The policy logs violations but blocks nothing.
**Impact:** No real XSS/injection mitigation from CSP despite the policy being defined.
**Fix:** After validating the report-only policy produces no legitimate violations, promote it to an
enforcing `Content-Security-Policy` header.

### 🟡 M-11 (Medium) — SEO: identical metadata on every page; missing `<h1>`
**What:** Every page shares the **same `<title>`** and a **43-character meta description**; `/booking`
and `/login` have no `<h1>`.
**Fix:** Per-page `<title>`/description via Next.js metadata; add a meaningful `<h1>` per page.

### ⚪ L-12 / L-13 / L-14 (Low)
- **L-12:** Duplicate `Strict-Transport-Security` header (two HSTS values returned).
- **L-13:** Mobile header showed **"Sign in"** while authenticated in one run — verify the mobile nav
  reflects auth state (may overlap with H-2 session expiry). Evidence: `artifacts/mobile/002-mobile-booking.png`.
- **L-14:** `whoAmI` returns **401** when logged out but **403** when the session is invalid —
  inconsistent semantics; pick one and handle both as "re-authenticate".

---

## 5. Positive security observations (no action needed)
- HSTS with `includeSubDomains; preload`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`,
  and an `HttpOnly; SameSite=Lax` visitor cookie are all present.
- Identity-document upload is verified server-side (rejected a synthetic non-licence image) — a strong
  anti-fraud control.
- Auth correctly returns generic "Invalid credentials" (no user enumeration) and gates `/dashboard`,
  `/my-bookings`, and booking checkout behind onboarding.

> Note: this engagement was front-end QA, not a penetration test. Security items above are
> observational (headers/flows) — no intrusive testing was performed.

---

## 6. Prioritised improvement backlog

1. **C-1** Stop the pre-hydration credential leak on `/login`. *(security, quick)*
2. **H-2** Handle expired sessions: redirect on 401/403, kill the infinite dashboard "Loading", make
   checkout fail loudly, refresh session during checkout.
3. **H-4** Make `booking.create` idempotent and GC abandoned `Pending payment` drafts (clean up the
   existing backlog on the test account).
4. **H-3** Validate licence-class/category eligibility at step 1 (or step 4), not at payment.
5. **M-5** Add a real "Change booking" flow (dates/time/category/extras), not just extend.
6. **M-7** Fix insurance default / make the paid pre-selection unmistakable.
7. **M-6** Populate real vehicle engine/odometer data.
8. **M-8** Fix PostHog config 404s and the Sentry `/monitoring` 500 so telemetry actually records.
9. **M-9** Accessibility remediation (start with `aria-prohibited-attr`, labels, icon-button names, h1s).
10. **M-10 / M-11 / L-12–14** Enforce CSP, add per-page metadata, dedupe HSTS, fix mobile auth nav.

---

## 7. How to reproduce / re-run

The harness lives in `harness/` (Node + Playwright). Key scripts:
- `login.mjs` — authenticate, save session.
- `lifecycle-create.mjs [tags]` — create 1/3/14-day bookings end-to-end through Stripe sandbox.
- `manage-execute.mjs` / `cancel-robust.mjs` — extend (modify) and cancel flows.
- `audit.mjs` — multi-page consistency + axe-core a11y + headers + broken-link sweep.
- `mobile-check.mjs` — responsive overflow check.

Run: `node harness/<script>.mjs`. Credentials are in `harness/secrets.local.mjs` (kept out of this
report). Stripe sandbox card `4242 4242 4242 4242`, any future expiry/CVV.

---

## 8. Test data created (left in place per instruction)
- **Confirmed:** `SCT-20260616-YNAQ3D` (1 d), `SCT-20260616-FP8776` (3 d), `SCT-20260616-NNWQBA` (14 d),
  `SCT-20260616-ANBDZN` (1 d → **extended** to 3 d as the modify test).
- **Cancelled:** `SCT-20260616-8AMYQS` (cancel test, reason "Changed plans").
- **Many `Pending payment`** drafts from payment-flow debugging (evidence for H-4).

---

## 9. Evidence index (screenshots under `artifacts/`)
- Login / credential-leak: `login/`
- Onboarding (KYC, ID verification, signature): `onboard/`
- Booking wizard steps 1–6 & quotes: `map/`, `book/`
- Licence-class block at payment: `book/005-reach-s6-payment.png`
- Confirmed payment outcomes: `book/*-s6-outcome.png`
- Manage (detail, cancel modal, extend modal, cancelled): `manage/`
- Multi-page audit + a11y: `audit/`, `audit/audit-results.json`
- Responsive: `mobile/`
