## What check-in is

Check-in is the return handover: closing out an active hire by recording the
vehicle's returned condition, settling any extra charges, dealing with the bond,
and putting the unit back on the fleet. Work the steps in order — each one builds
the evidence and the numbers the next one relies on.

You'll do this whenever a customer brings a bike back. It's the mirror image of
[checking a vehicle out](/staff/help/check-out-workflow): the pre-hire photos and
condition you captured at pickup are the baseline you compare against here.

## Where to start it

Open the booking from the [calendar or bookings list](/staff/help/bookings-calendar)
and use the **Change status** menu (top-right of the booking detail page):

| Booking status | Option to pick | What it does |
|---|---|---|
| `ACTIVE`, `OVERDUE`, `CHECKED_OUT` | **→ Check in** | Opens the guided check-in wizard (the recommended path). |
| `ACTIVE`, `OVERDUE`, `CHECKED_OUT` | **→ Returned (skip settlement)** | Shortcut that marks the bike returned without a signed statement — only for exceptions where you'll settle separately. |

The **→ Check in** option disappears once a return statement has been signed;
from then on the menu shows **→ Completed** instead, because the only thing left
is to close the booking out.

## The four steps

The check-in landing page shows a four-card checklist. Each card unlocks the next
once it's done.

| # | Step | What you capture |
|---|---|---|
| 1 | **Post-hire inspection** | Odometer, fuel level, overall condition, photos, and any new damage on the body map. |
| 2 | **Damage assessment** | One priced line per new damage item, plus the auto-calculated late and fuel fees. |
| 3 | **Sign return statement** | The customer initials each page; customer and staff both sign. |
| 4 | **Settle & close** | Collect the charges, capture or release the bond, and move the booking to `COMPLETED`. |

> Do steps 1–3 alongside the customer, before they leave. It's far easier to
> agree a damage charge face-to-face with the photos on screen than to chase it
> afterwards.

### Step 1 — Post-hire inspection

This is the condition record for the returned vehicle. The pre-hire damage map is
drawn underneath as a faint reference so you only mark what's *new*.

1. Enter the **odometer (km)** — the pickup reading is shown beside the field so
   you can sanity-check the distance travelled.
2. Set the **fuel level (%)**. This feeds the refuel charge in step 2, so read it
   off the gauge accurately.
3. Pick the **overall condition**: Excellent, Good, Fair or Poor.
4. **Photograph** the vehicle from every angle. Photos are your evidence if a
   charge is later disputed — be generous and well-lit.
5. On the **damage map**, choose a severity (Minor / Moderate / Major) and tap to
   drop a marker for each new mark. Pre-hire markers are shown in grey; your new
   ones in red/orange.
6. **Save progress** at any time, then **Proceed to damage assessment**.

Proceeding completes the inspection and opens a draft return assessment. See
[Inspections](/staff/help/inspections) for the inspection tool in detail.

### Step 2 — Damage assessment

Add one line per new damage item. For each line:

- **Description** — what and where (e.g. "Scratch on left-side panel").
- **Severity** — Minor / Moderate / Major.
- **Resolution** — how the item is handled:

| Resolution | Button label | Effect |
|---|---|---|
| `STANDARD` | Standard | Billed now. Pick a [damage-tariff](/staff/help/damage-tariff) item to auto-fill the price, or type an amount. |
| `QUOTE_PENDING` | Needs quote | Opens a work order. The customer authorises a charge **up to an acknowledged cap**; the final amount is billed once the mechanic quotes. |
| `WAIVED` | Waived | No charge — goodwill or not worth pursuing. |
| `WARRANTY` | Warranty | No charge to the customer — covered under warranty. |

The **Fees** card below shows two amounts the system works out automatically from
the inspection:

- **Late return fee** — see [late returns & overdue](/staff/help/late-returns-and-overdue)
  for the maths.
- **Fuel shortfall** — charged per missing litre against the pickup fuel level.

The **Totals** card sums standard damage + late + fuel into **Total due now**, and
shows the **pending quote cap** separately (it isn't billed yet). When the lines
are right, **Proceed to sign**.

### Step 3 — Sign the return statement

The return statement is the legal record of the return and the charges. The
customer reviews and **initials each page**, then both the **customer and a staff
member sign in full**. The statement is built from these pages:

| Page | Shows |
|---|---|
| Cover | Booking, vehicle, dates, return odometer & fuel. |
| Condition report | Pre-hire vs post-hire damage map and the return photos. |
| Damage charges | Every assessed line and its price. |
| Fees | Late and fuel charges with the workings. |
| Pending quote acknowledgment | *(Only if any line is "Needs quote")* — the capped amount the customer authorises. |
| Settlement | Total due now, pending cap, and how the bond will be applied. |

Both signatures are required — the **Finalise** button is blocked until they're
captured. Finalising:

- Renders the statement to a **PDF** and applies an **RFC3161 trusted timestamp**.
- Raises the charges as pending payments (damage, late, fuel — and a cleaning fee
  if you added one), so they're queued to collect.
- Marks the assessment **`SIGNED`** and adds the total to the booking's balance due.

You can re-open the signed PDF any time from the **Documents** tab on the booking.

### Step 4 — Settle & close

The old standalone "Settle" screen is now the **Payments & charges** tab on the
booking — finalising the statement takes you there. On that tab you:

1. **Collect the charges.** The damage, late, fuel and cleaning lines raised at
   signing sit as pending payments and are captured automatically off the
   customer's saved card. You can also **Record** a manual payment (cash, card,
   transfer) or **add a manual charge** if something was missed.
2. **Handle the bond.** **Capture** part or all of the held authorisation against
   what's owed, and **Release** the remainder. A clean return with nothing owed
   needs no capture — see [bonds & deposits](/staff/help/bonds-and-deposits) for
   how the hold and the 14-day auto-release work.
3. **Close out.** Use **Change status → Completed**. This sets the booking to
   `COMPLETED`, stamps who checked it in, writes the return odometer, and returns
   the vehicle to the fleet as `AVAILABLE`.

## Money: two worked examples

These figures are GST-inclusive (GST is the total ÷ 11 — see
[GST & the pricing cascade](/staff/help/gst-and-pricing-cascade)).

**Late fee.** Base daily rate $60, vehicle back 5 hours late. The first hour is a
free grace period, so 4 chargeable hours. The hourly rate is the daily rate ÷ 8 =
$7.50. Late fee = 4 × $7.50 = **$30.00**, capped at one daily rate ($60) per day.

**Fuel shortfall.** Picked up at 100%, returned at 75% — a 25% drop on an 8-litre
tank = 2 litres missing. At $2.50/litre that's **$5.00**.

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| "Proceed to damage assessment" doesn't appear | Inspection not started yet | Tap **Start post-hire inspection** first; the buttons appear once the draft exists. |
| Can't finalise the statement | One signature missing | Both customer **and** staff must sign in full; check the Settlement page is initialled too. |
| "Missing initials on pages…" | A page wasn't initialled | Scroll back to the named page(s) and capture initials, then finalise again. |
| No vehicle assigned at check-in | Unit was never allocated at pickup | Allocation happens at [check-out](/staff/help/check-out-workflow); fix the allocation on the booking before inspecting. |
| Damage cost not known yet | Needs a mechanic quote | Use **Needs quote** with a cap; the work order is settled later, not at check-in. |
| **→ Check in** option is gone | A return statement is already signed | Use **→ Completed** to close out — the wizard is done. |

## After check-in

- The vehicle is back on the fleet as `AVAILABLE`, but the availability engine
  holds a **cleaning buffer** before it can go out again — see
  [availability & allocation](/staff/help/availability-and-allocation).
- If it needs work, schedule it in [Maintenance](/staff/help/maintenance) so it
  stays off-hire.
- If something serious happened during the hire (crash, theft, major damage), log
  an [Incident](/staff/help/incidents). Tolls and fines that arrive later are
  matched and on-charged via [infringements & tolls](/staff/help/infringements-tolls).

<!-- TODO screenshots — capture once the dev DB has a booking in ACTIVE/OVERDUE
     with a vehicle allocated and a PRE_HIRE inspection (no such booking exists
     today, so shots would be empty/misleading):
     1. /staff/bookings/[id]/check-in — the four-step checklist landing page.
     2. /staff/bookings/[id]/check-in/inspect — readings + damage map with the
        pre-hire markers shown underneath.
     3. /staff/bookings/[id]/check-in/assess — a damage line + the Fees/Totals cards.
     4. /staff/bookings/[id]?tab=payments — the Payment Console (bond capture/release). -->
