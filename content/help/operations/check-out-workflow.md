Check-out is the pickup handover — the guided flow that turns a **CONFIRMED**
booking into an **ACTIVE** hire. You'll use it whenever a customer arrives to
collect a vehicle. It runs as a four-step wizard off the booking page, and the
system blocks each step until the one before it is done, so the legal and
safety paperwork can't be skipped. Work through it in order — every step
protects the customer, the vehicle and the business.

## Opening the wizard

From a booking detail page (`/staff/bookings/<id>`) or the calendar
(`/staff/calendar`), open **Check out**. The hub lists the four steps with a
**Done** marker against each as you complete it. A step's button stays disabled
until its prerequisites are met.

![The check-out hub: four numbered steps, each unlocking the next](/help/check-out-workflow/overview.png)

| Step | What happens | Unlocked once… |
|---|---|---|
| 1. Pre-hire inspection | Photos, odometer, fuel, condition, existing-damage map | Always available (needs a vehicle assigned) |
| 2. Identity & licence verification | Sight photo ID + a valid licence or passport | Step 1 started |
| 3. Sign rental agreement | Customer initials each page; customer + staff sign | Steps 1 & 2 done |
| 4. Confirm handover | Final checklist, hand over keys, complete check-out | Step 3 signed |

## Before the customer arrives

- Confirm the booking is paid and the **bond is authorised** (held, not
  captured — see [Bonds & deposits](/staff/help/bonds-and-deposits)).
- Make sure a clean, roadworthy vehicle is **allocated**. Allocation happens at
  check-out unless staff pre-assigned a unit earlier — see
  [Availability & allocation](/staff/help/availability-and-allocation). Step 1
  needs a vehicle assigned: if none is, the inspection page shows *"No vehicle
  assigned"* and you must assign one from the booking detail page first.
- Run **Step 1 (pre-hire inspection)** ahead of time if you can — it doesn't
  need the customer present and gets the slow part out of the way.

## Step 1 — Pre-hire inspection

This documents the vehicle's starting condition. It is the reference point for
any damage found at return, so be generous and methodical.

![Step 1: vehicle readings, condition, and the existing-damage map](/help/check-out-workflow/inspect.png)

1. **Record the readings** — odometer (km) and fuel level (%). Pick an
   **overall condition**: Excellent, Good, Fair or Poor. Tap **Start
   inspection** to save a draft; this unlocks photo capture.
2. **Take photos** from every angle in good light. These photos and the damage
   map are the baseline the return assessment compares against — don't rush
   this step.
3. **Mark existing damage** on the silhouette. Choose a severity (Minor,
   Moderate, Major) and tap the body view (Left / Right / Front / Rear) to drop
   a marker. Note pre-existing marks so the customer isn't charged for them
   later.
4. Tap **Ready for customer →** to save and move to verification.

> The inspection starts as a **draft**. It is sealed to **COMPLETED** when the
> rental agreement is finalised in Step 3 — a completed pre-hire inspection is a
> hard requirement for check-out, so a vehicle can never be handed over with no
> documented starting condition. For the full inspection toolset see
> [Inspections](/staff/help/inspections).

## Step 2 — Identity & licence verification

Confirm the customer is who they say they are and holds valid entitlement to
ride this category.

1. **Review the profile** — name, date of birth, licence number, state, class
   and expiry, plus any passport on file.
2. **Compare the on-file photos** (licence front/back and passport) against the
   physical documents in front of you.
3. Tick the two checks. Both are required to proceed:
   - **Photo ID sighted and matches the customer in person.**
   - **At least one of:** a valid driver's licence of the correct class for the
     booked category, **or** a valid passport.
4. **Save & proceed to signing →**.

Eligibility is re-checked again at the final step (see the eligibility note
below), so a licence that has expired between booking and pickup will be caught
even if it looked fine when the booking was made.

> **Motorcycle categories (class R / RE):** if eligibility rests on a passport
> alone — i.e. there's no valid riding licence of the right class on file — the
> page shows a prominent warning. Sight the customer's riding licence in person
> before handover. The warning does **not** block check-out, but it is recorded
> against the booking. Full guidance: [Licence
> verification](/staff/help/licence-verification).

## Step 3 — Sign the rental agreement

The agreement is the legal boundary of the hire. Starting it generates a
numbered draft; the customer works through it on the tablet.

The agreement has six pages, all of which must be **initialled**:

| # | Page | Covers |
|---|---|---|
| 1 | Cover | Booking, customer and vehicle summary |
| 2 | Pricing summary | The snapshotted hire price and GST |
| 3 | Vehicle condition report | Your Step 1 photos + damage map (customer can add their own marks) |
| 4 | Terms & conditions | The current versioned T&Cs |
| 5 | Bond & cancellation policy | Bond hold and cancellation tiers |
| 6 | Driver declarations | Rider declarations |

1. The customer **initials each page** as they review it.
2. The customer **signs in full**, then the **staff witness signs in full** —
   both signatures are required.
3. Tap to **finalise**. The system renders the signed PDF, applies an RFC3161
   trusted timestamp, seals the pre-hire inspection to COMPLETED and marks the
   agreement **SIGNED**.

Finalising fails with a clear message if any page is un-initialled or either
signature is missing. Once signed, you can **View signed PDF** from the signing
page or the confirm step (it opens in the in-app document viewer).

> If the timestamp service is unavailable the agreement still signs, but its
> timestamp status shows **FAILED** — a retry is available from the booking
> page. The handover is the source of truth; the timestamp is a tamper-evidence
> add-on.

## Step 4 — Confirm handover

The final review before the keys go over.

1. Check the summary — **Pre-hire inspection**, **Photo ID**, **Licence** and
   **Rental agreement** should all show a tick.
2. Optionally open **View / download PDF** to show or print the signed
   agreement.
3. Tick **"Keys, helmet and any agreed add-ons handed to the customer."**
4. Add **staff notes** if anything's worth recording (e.g. "customer arrived 15
   min late").
5. **Complete check-out.**

On completion the booking moves to **ACTIVE**, the allocated vehicle's status
becomes **RENTED**, the actual pickup time and pickup odometer are stamped, and
the customer is emailed a courtesy copy of the signed agreement and tax
invoice.

### What the system checks before it lets you finish

The **Complete check-out** action runs a final server-side gate. It will refuse
if any of these fail:

| Gate | Rule |
|---|---|
| Booking status | Must be CONFIRMED or PENDING_PAYMENT |
| Licence | Must be verified (unless an admin has turned the requirement off in system settings) |
| Eligibility | Re-checked at handover — age for the category, licence class/expiry, or a valid passport |
| Pre-hire inspection | A COMPLETED PRE_HIRE inspection must exist |
| Signed agreement | A SIGNED rental agreement must exist for this booking |
| Vehicle compliance | Blocks if the vehicle's **rego, CTP or insurance** expires before the booked return date — renew or reassign |
| Vehicle availability | If no unit is pre-assigned, one is allocated under a lock; if none is free you'll see *"No vehicle available to allocate"* |

## Money at check-out

The hire price was **snapshotted when the booking was made** — check-out doesn't
re-price it. Displayed prices are GST-inclusive (GST = total ÷ 11); see [GST &
the pricing cascade](/staff/help/gst-and-pricing-cascade). The **bond** is an
authorisation hold on the customer's card, **not a charge** — see [Bonds &
deposits](/staff/help/bonds-and-deposits).

## Common issues & troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Step 1 says "No vehicle assigned" | Booking has no allocated unit | Assign a vehicle from the booking detail page, then start the inspection |
| Step 2 won't proceed | One of the two checks is un-ticked | Both the photo-ID check and the valid-ID check must be confirmed |
| Red banner on Step 2 (motorcycle) | Eligibility rests on a passport only for an R/RE category | Sight the riding licence in person; the warning is recorded but doesn't block |
| Can't finalise the agreement | A page is un-initialled or a signature is missing | Complete every page's initials and both full signatures |
| "Pre-hire inspection required" at Step 4 | No COMPLETED inspection (draft not sealed) | Finish Step 1 and finalise the agreement, which seals it |
| "Cannot check out … expires before return date" | Vehicle rego/CTP/insurance lapses mid-hire | Renew the document or reassign a compliant vehicle |
| "No vehicle available to allocate" | No free unit in the category/depot for the dates | Resolve the clash or escalate; check [Availability & allocation](/staff/help/availability-and-allocation) |
| Timestamp shows FAILED | TSA was unreachable at signing | Retry timestamping from the booking page; the signature itself is valid |

## Next

When the vehicle comes back, follow [Checking a vehicle
in](/staff/help/check-in-workflow). To change a hire before or during it, see
[Extending, swapping & cancelling](/staff/help/extend-swap-cancel).
