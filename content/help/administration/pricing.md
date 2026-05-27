# Pricing

Pricing controls what customers pay to hire. The system applies a defined
**cascade** of rules to reach a final price, which is then snapshotted onto the
booking. Understanding the order is the key to changing prices safely.

## The pricing cascade

Prices are built up in this order:

1. **Category base rate** — the starting daily rate for the vehicle's category.
2. **Duration discount** — longer hires get a lower effective rate.
3. **Seasonal multiplier** — peak / off-peak adjustments by date.
4. **Depot override** — a specific depot can adjust the rate.
5. **Discount code** — a final reduction if the customer has a valid code.

The result is rounded to the nearest cent and **snapshotted** onto the booking,
so later rate changes never retroactively alter an existing booking.

## What you can configure

- **Base rates** per category.
- **Duration discount** bands.
- **Seasonal multipliers** by date range.
- **Depot overrides** (also reachable from **Depots**).
- **Discount codes** and their rules.

## GST is built in

All prices are **GST-inclusive** at 10%. You set the price the customer sees; the
system derives the GST component (total ÷ 11) for invoicing. Don't try to add GST
on top — see **GST & the pricing cascade**.

## Change pricing carefully

- A change affects **new** bookings only — existing ones keep their snapshot.
- Test the effect on a sample category/date before a broad change.
- Big pricing moves are worth coordinating with whoever owns yield/revenue.

Pricing sits alongside **Finance**; the two together govern revenue.
