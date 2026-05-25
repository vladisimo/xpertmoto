## What this is

The Operations dashboard (**/staff/dashboard**) is the first screen to open at the
start of a shift. It pulls the day's most time-sensitive work — pickups, returns,
overdue hires, fleet compliance and tyre alerts, plus waiting support tickets —
into one tabbed view so nothing slips through. Use it as your shift cockpit:
glance at the tab badges, work the red ones down, and jump straight into the job
from each row.

Everything on the page is **scoped to your depot** if your account is tied to one.
The header reads *"Your depot · {{today's date}}"*; if you have no depot set, it
shows *"All depots"* and counts across every location. The **All bookings** button
top-right opens the full [calendar](/staff/calendar).

![The staff dashboard on the Fleet tab: the left navigation, the page header showing your depot and today's date, the six operations tabs with live red count badges (here Fleet 16 and Tyres 13), the four KPI cards and the "Vehicles needing attention" list.](/help/operations-dashboard/fleet.png)

## Reading the tab bar

Six tabs run across the top. Each can carry a small **red count badge** when it
has items needing attention — the badge only appears when the count is above zero,
so a clean bar means a clean depot.

| Tab | What it shows | Badge counts |
|---|---|---|
| **Today** | The day's pickups and returns | — (no badge) |
| **Overdue** | Hires past their scheduled return | Bookings still out past return time |
| **Fleet** | Vehicles with expiring compliance or due service | Vehicles needing attention |
| **Mistakes** | Booking ↔ vehicle ↔ maintenance inconsistencies | Total flagged issues |
| **Tyres** | Vehicles flagged for tyre work | Open tyre alerts |
| **Support** | Customer tickets awaiting a reply | — (no badge) |

Switching tabs updates the `?tab=` in the address bar, so you can bookmark or
share a direct link (e.g. `/staff/dashboard?tab=overdue`).

## Today

The default tab and your main run-sheet for the day. Four KPI cards sit across the
top, followed by two lists.

**KPI cards**

| Card | Meaning |
|---|---|
| Today's pickups | Bookings due to go out today (status CONFIRMED or PENDING_PAYMENT) |
| Today's returns | Bookings due back today (status ACTIVE or CHECKED_OUT) |
| Active rentals | All vehicles currently out on hire |
| Overdue | Hires past their return time — turns **red** when above zero |

**Today's pickups** lists each booking due out, earliest first, with the booking
reference, customer name, category, allocated vehicle code, the pickup → return
window and the total. The **Check out** button opens that booking's
[check-out flow](/staff/help/check-out-workflow).

**Today's returns** lists bookings due back, each with a **Check in** button that
opens the [check-in flow](/staff/help/check-in-workflow).

> A booking only appears under pickups once it is **CONFIRMED** (or awaiting
> payment). Quotes and draft bookings won't show here — find those on the
> [calendar](/staff/calendar).

### How to work the Today tab

1. Open the dashboard at the start of your shift; it lands on **Today**.
2. Prep each pickup *before* the customer arrives: confirm the licence is
   [verified](/staff/help/licence-verification), the vehicle is allocated, clean
   and within its [2-hour cleaning buffer](/staff/help/availability-and-allocation).
3. As each customer arrives, hit **Check out** on their row.
4. Through the day, clear **Today's returns** with **Check in** as bikes come back.

## Overdue

Bookings that are past their scheduled return time. Treat this tab as priority
one — every overdue hire is a tied-up vehicle and unbilled time.

The four KPIs track the **automated escalation ladder** (driven by a background
job, not by you):

| KPI | Trigger |
|---|---|
| Not returned | Any booking past its return time — turns **red** when above zero |
| Notice sent | First overdue notice has gone out (from **+1 hour**) |
| Manager escalation | Escalated to a manager (from **+24 hours**) |
| Over 24 hours | Still not returned more than a day later |

The escalation timeline is: **notice at +1h → second nudge at +12h → manager
escalation at +24h → theft report filed at +72h.** The grace period and late-fee
maths are explained in [Late returns & overdue](/staff/help/late-returns-and-overdue) —
in short, after a 1-hour grace period the hourly rate is the daily rate ÷ 8,
capped at one day's rate per day.

The **Not returned** table below lists each overdue booking with its current
stage so you can see who has already been contacted and who still needs chasing.

<!-- TODO screenshot: /staff/dashboard?tab=overdue — the Not returned table with the four escalation KPIs. Capture against a depot that has at least one overdue hire; the dev DB currently has none. -->

## Fleet

This tab is about **vehicle compliance and servicing**, not live hire status. It
surfaces bikes whose paperwork is about to lapse or that are due for a service, so
you can pull them off-hire before they become a problem.

| KPI | Window |
|---|---|
| Rego expiring | Registration lapses within **7 days** |
| CTP expiring | Compulsory Third Party insurance lapses within **30 days** |
| Insurance expiring | Comprehensive insurance lapses within **30 days** |
| Service due | Next service due within **14 days** |

The **Vehicles needing attention** list shows every active vehicle matching any of
the above (rego/CTP/insurance within 30 days, or service within 14), with the
specific dates. Each row links into [Fleet](/staff/help/fleet) on the vehicles tab,
where you can book the work in [Maintenance](/staff/help/maintenance). The
screenshot at the top of this page shows the Fleet tab in action.

> For live availability (how many bikes are free to rent right now) use the
> [calendar](/staff/calendar) or the [Fleet](/staff/fleet) page — the dashboard
> Fleet tab is a compliance watchlist, not an availability count.

## Mistakes

Booking ↔ vehicle ↔ maintenance inconsistencies that the automatic conflict check
doesn't block but a human should look at.

| KPI | Meaning |
|---|---|
| Unallocated | Imminent bookings with no vehicle assigned yet |
| Maintenance conflicts | A booking overlaps a maintenance window on the same vehicle |
| Status mismatches | Booking status and vehicle status disagree (e.g. ACTIVE hire on an "available" bike) |
| Docs expiring mid-booking | Rego/CTP/insurance lapses *during* a confirmed hire |

Clear these promptly: an unallocated pickup or a doc expiring mid-hire will stall a
check-out. Allocation happens at check-out time unless staff pre-allocate — see
[Availability & allocation](/staff/help/availability-and-allocation).

## Tyres

Vehicles flagged for tyre attention, drawn from inspection records.

| KPI | Flag reason |
|---|---|
| Total alerts | All open tyre flags |
| Tread < 2mm | Tread depth below the legal/safety minimum |
| High km since last change | Distance travelled since the last tyre replacement is high |
| Inspection overdue | No recent tyre inspection on record |

Tyre data comes from [Inspections](/staff/help/inspections); a bike with low tread
should be sent to [Maintenance](/staff/help/maintenance) before it goes out again.

## Support

A snapshot of customer tickets awaiting a reply **at your depot**, so front-desk
staff can triage between customers before issues escalate. Two shortcuts sit below
the list: **Support inbox →** opens [Support tickets](/staff/help/support-tickets),
and **Communications →** opens the [comms log and composer](/staff/help/communications).

## A typical shift, in order

1. **Overdue first.** Chase anything in the Not returned list — it's lost revenue
   and a stranded vehicle.
2. **Prep Today's pickups.** Verify licences, allocate and clean each bike.
3. **Scan Fleet & Tyres.** Pull any bike with lapsing compliance or low tread
   off-hire so it isn't allocated to a customer.
4. **Clear Mistakes.** Fix unallocated or conflicting bookings before they block a
   check-out.
5. **Work returns** with **Check in** as bikes come back.
6. **Answer Support** in the gaps.

For a single prioritised to-do list spanning the whole depot rather than this
tab-by-tab view, use [Priority tasks](/staff/help/priority-tasks).

## Worked example

It's **Tuesday morning** and your dashboard shows: Today's pickups **6**, Today's
returns **4**, Active rentals **18**, Overdue **2** (red). The tab bar shows
**Overdue 2**, **Fleet 1**, **Tyres 1**.

- Start on **Overdue**: two bikes are out past return. One shows "Notice sent"
  (it's +3h, the +1h notice already went); the other is "Over 24 hours" and
  flagged for manager escalation. Call both customers.
- **Fleet** badge of 1: one bike's rego expires in 5 days — book it for renewal so
  it isn't allocated to today's pickups.
- **Tyres** badge of 1: tread < 2mm on a scooter — send it to maintenance, don't
  hand it out.
- Back to **Today**: prep the 6 pickups, then check the 4 returns in as they
  arrive.

## Common issues & troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| A confirmed booking isn't under Today's pickups | It isn't due *today*, or its status isn't CONFIRMED/PENDING_PAYMENT. Check the [calendar](/staff/calendar). |
| Counts look too high / too low | You may be seeing **all depots**. If your account has no depot set, ask an admin to assign one in [Users & roles](/admin/help/users-and-roles). |
| Overdue stage looks stale | Escalation is driven by a background job on Australia/Brisbane time; stages advance on a schedule, not instantly. |
| Fleet tab is empty but bikes are off the road | This tab only tracks *compliance/service* expiry, not live VEHICLE status. Use [Fleet](/staff/fleet) for current status. |
| A pickup row has no vehicle code | The booking is unallocated — it'll also appear under **Mistakes → Unallocated**. Allocate it before check-out. |

## Tips

- **Bookmark a tab.** The active tab lives in the URL (`?tab=overdue`), so you can
  pin the view you check most.
- **Badges are your triage signal.** A red number on a tab means action is waiting
  there; an empty bar means you're clear.
- **The dashboard is read-then-act.** Most rows deep-link to where you do the work
  (check-out, check-in, fleet, support) — don't action things from memory, follow
  the link.

---

### Screenshots

- [x] `/staff/dashboard?tab=fleet` — Vehicles needing attention + compliance KPIs (shown above; captured via `scripts/capture-dashboard-help.ts`).
- [ ] `/staff/dashboard` (Today tab) — tab bar + populated pickups/returns lists. Re-shoot against a depot that has bookings due today (the dev DB had none, so the live view was all zeros).
- [ ] `/staff/dashboard?tab=overdue` — Not returned table + escalation KPIs. Re-shoot when at least one hire is overdue.
