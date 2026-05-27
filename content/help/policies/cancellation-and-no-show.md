# Cancellation & no-show policy

When a booking is cancelled, the refund depends on how much notice the customer
gives. The system calculates this for you when you cancel a booking — this
article explains the rules behind it so you can answer customers confidently.

## The refund tiers

| Notice before pickup | Outcome |
|---|---|
| **More than 72 hours** | Full refund **minus the admin fee** |
| **24–72 hours** | **50%** refund |
| **Less than 24 hours** | **No refund** |
| **No-show** (never arrived) | **No refund, plus a no-show fee** |

The admin fee and no-show fee amounts, and the exact tier boundaries, are
configurable in **System Settings** — so always trust what the system calculates
over a remembered figure.

## How to cancel

Open the booking and choose cancel; the refund is computed from the policy and
the time remaining before pickup, and processed back to the original payment
method. You don't calculate the refund by hand. See **Extending, swapping &
cancelling**.

## No-shows

A no-show is a customer who never collects the vehicle. It's treated as the
strictest tier: no refund, plus the no-show fee. No-show status can be set
automatically by a scheduled job after the pickup window passes.

## Answering customers

- Be clear and calm: the tier is based on **notice given**, applied consistently
  to everyone.
- If a customer disputes the timing, the booking record shows exactly when the
  cancellation happened relative to pickup.
- Genuine exceptional circumstances are a management decision — escalate rather
  than improvising a refund.
