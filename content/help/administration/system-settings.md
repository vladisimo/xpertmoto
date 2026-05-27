# System settings

System Settings is the super-admin home for the global configuration that shapes
the whole deployment. Changes here affect every user and every customer, so treat
it with care.

## What lives here

- **Branding** — trading name, legal name, ABN, support contact, logos and brand
  colour. This is what makes the product "{{siteName}}". Everything customer-facing
  (the site, emails, invoices, PDFs) reads from here, so it's the *only* correct
  place to change these — never hardcode them anywhere else.
- **Business-rule defaults** — the values behind the policies:
  - cancellation refund tiers and the admin / no-show fees,
  - the bond amount and the auto-release window,
  - the late-return grace period and hourly-fee maths,
  - the cleaning buffer between hires.
- **Feature flags & policy toggles** — e.g. whether OAuth sign-in is allowed for
  back-office accounts.

## Changing a business rule

1. Find the setting and note its current value.
2. Change it deliberately — these feed live calculations. For example, the
   cancellation tiers directly determine refunds (see **Cancellation & no-show
   policy**) and the bond window controls when holds release (see **Bonds &
   deposits**).
3. Confirm any **notification templates** that quote these values still match —
   a template promising "full refund up to 72 hours" must agree with the setting.

## Why this matters

The policies described throughout this help centre aren't hardcoded — they read
from here. That's powerful (you can adjust the business without a code change) and
risky (a wrong value quietly changes what customers are charged or refunded).
Change one thing at a time and verify the effect.
