# Extending, swapping & cancelling

Hires don't always go to plan. These mid-hire changes are all launched from the
booking detail page.

## Extend

A customer wants the vehicle for longer:

1. Open the booking and start an **extension**.
2. The system checks the vehicle is still available for the new dates (no
   clashing booking or maintenance).
3. The additional hire is priced and charged. Pricing follows the same cascade
   as the original booking — see **GST & the pricing cascade**.

If the vehicle isn't available for the extra time, consider a **swap** instead.

## Swap

Move the customer onto a different vehicle mid-hire — because the current one
needs to come off the road, or the customer needs something different:

1. Open the booking and start a **swap**.
2. Pick a replacement vehicle from those available.
3. Close out the original unit (it can go to maintenance or back to the fleet)
   and the customer continues on the new one.

## Cancel

If a booking won't go ahead, cancel it from the booking page. The **refund is
calculated automatically** from the cancellation policy based on how much notice
is given:

| Notice before pickup | Refund |
|---|---|
| More than 72 hours | Full refund minus the admin fee |
| 24–72 hours | 50% refund |
| Less than 24 hours | No refund |
| No-show | No refund, plus a no-show fee |

The exact figures are configurable in System Settings. See **Cancellation &
no-show policy** for the full detail.

## A note on records

Each of these actions is audited and adjusts the booking's balance. You don't
need to do the maths by hand — the system raises or refunds the right amount and
keeps the booking's balance due in step.
