# Availability & allocation

Two related ideas govern whether a customer can book a vehicle and which physical
unit they end up on: **availability** (can this be booked?) and **allocation**
(which specific bike?).

## When is a vehicle available?

A vehicle is bookable for a requested period only when **all** of these hold:

- Its status is **Available** (not on hire, not in maintenance, not otherwise off
  the road).
- There's **no overlapping confirmed or active booking** for that period.
- There's **no overlapping maintenance** scheduled.
- There's a **cleaning buffer** (typically 2 hours) clear between one hire ending
  and the next beginning.

If any of these fail, the unit won't be offered. This is why accurate **fleet
status** and properly logged **maintenance** matter so much — they're inputs to
this calculation.

## When is a unit allocated?

Allocation — tying a booking to a *specific* vehicle — happens at **check-out**,
not at booking time, unless staff **pre-allocated** a unit earlier. This keeps
the fleet flexible: the system commits a particular bike only when it's actually
going out the door.

## Why it works this way

- Booking against a *category* rather than a specific bike means a last-minute
  maintenance issue can be absorbed by swapping units, without disturbing the
  customer.
- The cleaning buffer guarantees a returned bike is prepped before it goes out
  again.

## For staff and admins

- **Staff:** allocate at check-out from the units the system offers (all guaranteed
  clear of clashes). See **Checking a vehicle out**.
- **Admins:** availability is calculated per **depot** within its opening hours —
  keep depot configuration and maintenance records accurate so the calculation
  can be trusted. See **Depots** and **Fleet**.
