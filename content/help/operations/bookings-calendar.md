The Bookings area is the operational home of every hire. It opens on a
**calendar** so you can read the day's pickups, returns and pressure points at a
glance, and it's the launch point for creating walk-in bookings and running each
booking through its full lifecycle. Find it in the staff sidebar under
**Operations → Bookings** (`/staff/calendar`).

There is no separate "bookings list" page — the calendar *is* the landing
screen, and the fastest way to a specific booking is global search (see
[Finding a specific booking](#finding-a-specific-booking)).

## What you see at the top

A row of four stat cards sits above the calendar and refreshes as bookings move
through their lifecycle. They reflect the depot you've filtered to (or all
depots if no filter is set).

| Card | What it tells you |
|---|---|
| **Active rentals** | Vehicles currently out (CHECKED_OUT or ACTIVE), with a line showing how many are picking up and returning *today*. |
| **Today's flow** | A stacked bar of today's pickups, today's returns and overdue returns — your at-a-glance workload for the shift. |
| **Fleet utilisation** | A donut of the fleet split into Rented / Available / Maintenance / Off-fleet, with the rented-share percentage in the centre. |
| **Overdue watch** | Overdue returns measured against active on-fleet hires, so an overdue spike stands out. |

For a deeper daily worklist (today's pickups, returns and items needing
attention as actionable rows), use the [Operations dashboard](/staff/help/operations-dashboard).

## Reading the calendar

![The bookings calendar in month view — blue up-arrow markers are pickups, orange down-arrow markers are returns, and grey markers are cancelled bookings.](/help/bookings-calendar/calendar-month.png)

Every booking is plotted as **two point-in-time markers**, not a bar that spans
the hire:

- an **↑ pickup** marker at the scheduled pickup time, and
- a **↓ return** marker at the scheduled return time.

Each marker is colour-coded by where that leg of the hire stands. The legend
below the calendar mirrors these colours:

| Marker | Meaning |
|---|---|
| **Pickup** (blue) | Pickup is still due — not yet checked out. |
| **Picked up** (green) | Vehicle has been checked out. |
| **No show** (near-black) | Pickup time passed with no check-out, or the booking is marked NO_SHOW. |
| **Return due** (orange) | Return is scheduled and not yet overdue. |
| **Overdue** (red) | Return time has passed and the vehicle is still out. |
| **Returned** (grey-blue) | Vehicle has been checked back in. |
| **Cancelled** (light grey) | Booking was cancelled. |

### Navigating and filtering

- **Views:** switch between **Month**, **Week**, **Day** and **List** with the
  buttons top-right of the grid.
- **Move through time:** use the **‹ ›** arrows and **today** at the top-left.
  The visible date range *is* your time filter — there is no separate
  date-range picker.
- **Vehicle type:** the **All types** dropdown lets you tick one or more vehicle
  categories to show only those.
- **Depot:** the **All depots** dropdown narrows the calendar (and the stat
  cards) to a single depot. With a single-depot tenant this is fixed to that
  depot.

**Click any marker** — pickup or return — to open that booking's detail page.

## Creating a booking

### Walk-in / POS (counter sales)

For a customer standing at the counter, use the walk-in flow. Click **+ New
walk-in** in the page header to open the **Walk-in / POS** side panel (it slides
in over the calendar — it is not a separate menu item or page).

![The Walk-in / POS panel: choose an existing or new customer, set depot and times, then pick from the live list of available vehicles.](/help/bookings-calendar/walk-in-pos.png)

Work top to bottom:

1. **Customer** — either **Existing customer** (search by name, email or phone
   and pick a match) or **New customer** (quick-create with first/last name,
   email, phone and licence number + state). Name and email are the minimum for
   a new customer.
2. **Depot** — auto-selected when there's only one; otherwise choose it.
3. **Pickup and return date & time** — return must be after pickup, and both
   must fall within the depot's operating hours (you'll see an inline warning if
   not).
4. **Category filter** *(optional)* and **Payment method** (Card or Cash).
5. **Vehicle** — the list shows only vehicles actually available for that depot
   and period (respecting overlaps, maintenance and the cleaning buffer — see
   [Availability & allocation](/staff/help/availability-and-allocation)). Each
   row shows the internal code, make/model, rego, odometer and daily rate.
6. Review the **Total** (GST-inclusive) and **Bond to hold**, then click
   **Create booking & proceed to check-out**.

This creates the booking and takes you straight into the
[check-out flow](/staff/help/check-out-workflow) — licence verification,
allocation, inspection and signing.

> The displayed total is GST-inclusive (GST = total ÷ 11) and the bond is the
> category's standard hold — authorised on the card, not captured. See
> [GST & the pricing cascade](/staff/help/gst-and-pricing-cascade) and
> [Bonds & deposits](/staff/help/bonds-and-deposits).

### Online bookings

Bookings customers make on the public website flow in automatically and appear
on the calendar as soon as they're created — no manual entry needed.

## Finding a specific booking

The quickest route to a known booking is **global search**: press **⌘K**
(macOS) or **Ctrl+K** (Windows/Linux) anywhere in the back office and type a
booking reference, customer name or vehicle rego. Search also covers vehicles,
customers, receipts and tax invoices. Otherwise, navigate the calendar to the
pickup or return date and click the marker.

## On the booking detail page

Clicking a marker opens the booking. From here you run the whole lifecycle. The
header shows the **status badge**, the **source** (e.g. walk-in, online) and any
flags (Delivery, Extension). Below it, a strip of money cards reads the
financial state at a glance: **Balance due**, **Bond held**, **Next recurring
charge**, **Tolls**, **Infringements** and **Incidents**.

**Actions available depend on the booking's current status:**

| Action | Where | When it appears |
|---|---|---|
| **Check out** | "Change status" → Check out | Booking is CONFIRMED or PENDING_PAYMENT |
| **Check in** | "Change status" → Check in | Vehicle is CHECKED_OUT, ACTIVE or OVERDUE |
| **Extend** | header button | CONFIRMED, CHECKED_OUT or ACTIVE |
| **Swap vehicle** | "Swap vehicle" button | A vehicle is allocated and the hire is open |
| **Cancel booking** | header button (or "Change status") | QUOTE, PENDING_PAYMENT or CONFIRMED only |
| **Resend confirmation** | header button | CONFIRMED through COMPLETED |
| **Record payment** | "Change status" / Payments tab | A balance is outstanding |
| **Mark no-show** | "Change status" → No show | Pickup time has passed without check-out |

The **Change status** dropdown only offers transitions that are valid right now,
so you can't, for example, cancel a booking whose vehicle is already out — once
the customer has the vehicle, the way to close the booking is **Check in**.

Detail-page tabs:

- **Overview** — customer, ride, charges, verification, add-ons/insurance and
  who did what.
- **Payments & charges** — the payment console, bond ledger, invoices and
  adjustment notes, and the pricing snapshot taken when the booking was made.
- **Documents** — rental agreement and return assessment PDFs.
- **Activity** — inspections, incidents and infringements.
- **Notes & audit** — internal notes and the booking's audit trail.

Step-by-step guides for the main transitions:
[Checking a vehicle out](/staff/help/check-out-workflow),
[Checking a vehicle in](/staff/help/check-in-workflow), and
[Extending, swapping & cancelling](/staff/help/extend-swap-cancel).

## On a phone or small screen

Below tablet width the calendar is replaced by a **day agenda**. A horizontal
strip of day chips covers today plus the next 13 days (Today / Tomorrow /
weekday + date); tap a day to list that day's bookings in pickup-time order. Tap
a row to open the booking. This is the layout staff get on a phone at the
counter or kerbside.

## Common issues

| Symptom | Likely cause / fix |
|---|---|
| A booking isn't on the calendar | It's outside the visible date range — move the view to its pickup/return date, or it was filtered out by the **type** or **depot** dropdown. |
| No vehicles show in the walk-in panel | No depot selected, an invalid time range, or nothing is available for that depot and period (overlap, maintenance or cleaning buffer). Try a different time or category. |
| "Return must be after pickup" / operating-hours warning | Adjust the pickup or return time so the range is valid and within the depot's open hours. |
| Can't cancel a booking | The vehicle is already checked out — close it via **Check in** (or **Returned**) instead. Cancellation is only for QUOTE / PENDING_PAYMENT / CONFIRMED. |
| Marker is the wrong colour | Colours track the *live* lifecycle state (e.g. a return past its time turns red/Overdue automatically). Open the booking to confirm and act. |

## Related

- [Operations dashboard](/staff/help/operations-dashboard)
- [Availability & allocation](/staff/help/availability-and-allocation)
- [Checking a vehicle out](/staff/help/check-out-workflow) ·
  [Checking a vehicle in](/staff/help/check-in-workflow) ·
  [Extending, swapping & cancelling](/staff/help/extend-swap-cancel)
- [GST & the pricing cascade](/staff/help/gst-and-pricing-cascade) ·
  [Bonds & deposits](/staff/help/bonds-and-deposits)
- [Cancellation & no-show policy](/staff/help/cancellation-and-no-show) ·
  [Late returns & overdue](/staff/help/late-returns-and-overdue)
