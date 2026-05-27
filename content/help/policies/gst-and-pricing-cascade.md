# GST & the pricing cascade

This article explains two things every back-office user should understand: how
GST works in {{siteName}}, and the order in which a hire price is built up.

## GST is inclusive

Australian prices here are **GST-inclusive** — the price a customer sees already
contains 10% GST. To find the GST component you **divide the total by 11**, you do
not add 10% on top.

- A $110 hire contains **$10 of GST** ($110 ÷ 11).
- The system calculates this for you on every invoice; you never hand-calculate
  it into a price.

Every tax invoice carries the {{legalName}} ABN ({{abn}}) — required by law and
filled in from branding configuration, never typed by hand.

## The pricing cascade

A booking's price is built by applying these in order:

1. **Category base rate** — the daily rate for the vehicle's category.
2. **Duration discount** — a longer hire lowers the effective daily rate.
3. **Seasonal multiplier** — peak/off-peak adjustment by date.
4. **Depot override** — a specific location can adjust the rate.
5. **Discount code** — a final reduction for a valid code.

The result is **rounded to the nearest cent** and **snapshotted onto the
booking**. That snapshot is what protects the customer: a later rate change never
alters a price that was already quoted and agreed.

## Why this matters at the counter

- The price on a booking is fixed at the time it was made — if a customer queries
  it, the snapshot is the answer, not today's rate card.
- Extensions and changes re-run the same cascade for the new portion.
- Admins changing rates affect **new** bookings only. See **Pricing** to make
  changes and **Finance** for the money side.
