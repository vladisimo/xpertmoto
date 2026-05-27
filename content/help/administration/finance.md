# Finance

The Finance hub is where the money side of {{siteName}} is configured and
reconciled. It's organised into sub-pages, each covering one part of the picture.

## The sub-pages

- **Bonds** — security deposits held against hires: what's authorised, held and
  released. See **Bonds & deposits**.
- **Categories** — financial / accounting categories used to classify revenue and
  charges.
- **GST** — goods and services tax configuration. All displayed prices are
  GST-inclusive at 10%. See **GST & the pricing cascade**.
- **Invoices** — tax invoices issued to customers. Every invoice carries the
  {{legalName}} ABN ({{abn}}).
- **Reconciliation** — matching payments received against what was charged, so
  the books balance.
- **Transactions** — the ledger of payments, refunds, captures and voids.

## Day-to-day

- Use **Reconciliation** regularly to catch mismatches early.
- Check **Bonds** for authorisations that are due to release or need capturing.
- Pull tax **Invoices** when a customer needs a copy (use the in-app PDF viewer,
  not a new browser tab).

## Important money rules

- **Prices are GST-inclusive.** GST is the total divided by 11. The system
  computes this for you — never hand-calculate it into a price.
- **Balances stay in step.** Every charge raised increases a booking's balance
  due; every capture, refund or void decreases it. You don't reconcile this by
  hand — the system maintains the invariant.
- **ABN on every invoice.** The trading name, legal name and ABN come from
  branding configuration, never hardcoded.

For the rules behind charges and refunds, read the **Policies & concepts** guides.
