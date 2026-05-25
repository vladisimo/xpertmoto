Priority Tasks is the back office's shared, prioritised work queue. Where the
[operations dashboard](/staff/help/operations-dashboard) shows *what's happening
today*, Priority Tasks shows *what needs a human to act now* — each job ranked by
urgency, claimable by one person at a time, and deep-linked straight to the screen
where you finish it. Open it at [Priority Tasks](/staff/tasks).

The queue is **live**: it's rebuilt from the current state of bookings,
inspections, work orders and agreements every time you load the page, and it
auto-refreshes every 30 seconds. There's no manual "create task" — tasks appear
when the underlying work becomes actionable and clear themselves the moment the
work is done.

## What you're looking at

The page has two tabs and a banner:

- **Queue** — open work, ranked. This is where you spend your shift.
- **History** — completed, abandoned and superseded tasks, with timing metrics.
  Useful for managers reviewing throughput.
- A **"You have work in progress"** banner appears at the top whenever you have
  tasks you've claimed but not finished, so you can jump back in from anywhere.

If you're signed in at a depot, the Queue is scoped to **your depot**. If your
account has no depot set, you'll see tasks across **all depots**.

![The Priority Tasks Queue tab: a "You have work in progress" banner across the top with Continue / Done / Abandon buttons; the Queue and History tabs; four summary cards (Open tasks, By priority, Claim mix, Queue age); the Priority and "Only show tasks claimed by me" filters; and a task table with a Medium pickup claimed by the current user, an Urgent overdue and a High return awaiting a claim, each with View and Start actions.](/help/priority-tasks/queue-overview.png)

## What shows up in the queue

The queue is built by a set of *collectors* that scan live operational data. As of
today the following task types are wired up and will appear:

| Task type | Appears when | Takes you to |
|---|---|---|
| Booking pickup | A confirmed/awaiting-payment booking is due for pickup today | [Check-out flow](/staff/help/check-out-workflow) |
| Booking return | An active/checked-out booking is due back today | [Check-in flow](/staff/help/check-in-workflow) |
| Overdue booking | A hire is past its return time and not yet checked in | Booking detail (to chase the customer) |
| Pre-hire inspection | A vehicle needs inspecting before hand-over | [Inspection](/staff/help/inspections) on the check-out |
| Post-hire inspection | A returned vehicle needs inspecting | Inspection on the check-in |
| Work order | A maintenance work order needs action | [Maintenance](/staff/help/maintenance) work order |
| Rental agreement signature | An agreement is unsigned at check-out | Sign step of the check-out |
| Return assessment finalise | A return is awaiting settlement | Settle step of the check-in |

Other categories (licence verification, bond release review, incident triage,
support tickets, infringement nomination, damage-charge confirmation and more) are
defined in the system but **not yet surfaced** in the queue — they're handled today
from their own screens (e.g. [Licence verification](/staff/help/licence-verification),
[Bonds & deposits](/staff/help/bonds-and-deposits)). Don't expect them in this list yet.

> If a collector times out or errors, the page degrades rather than hangs: you'll
> see a small "Some collectors failed or timed out" note and the affected task types
> are simply missing from that refresh. Reload to retry.

## Priority tiers

Every task carries one of four priority tiers, shown as a coloured badge and used to
sort the queue (highest first, then oldest-first within a tier):

| Tier | Meaning |
|---|---|
| **Urgent** | Overdue or already past its due time — act first. |
| **High** | Due imminently (within the next 2 hours). |
| **Medium** | Due later today. |
| **Low** | Lowest priority. |

Tiers are computed from the data, not set by hand. For the booking family:

| Situation | Tier |
|---|---|
| Pickup whose time has already passed | Urgent |
| Pickup due within 2 hours | High |
| Pickup due later today | Medium |
| Return due within 2 hours | High |
| Return due later today | Medium |
| Overdue ≥ 24 hours, or escalation stage 3+ | Urgent |
| Overdue < 24 hours | High |

## The claim model: Start, Continue, Done, Abandon

Tasks are **claimed**, not just opened. Claiming stops two people doing the same
job and lets the system measure how long work takes. A task can only be claimed by
one person at a time.

Each row's right-hand side shows:

- **View** (dropdown) — read-only deep-links to the related booking, customer
  profile or asset. Use this to *peek* before committing — it navigates **without
  claiming** the task.
- **Start** — claims the task for you and takes you straight to the action screen.
- **Continue** / **Abandon** — shown instead of Start when *you* hold the claim.
- **Claimed** (greyed out) — shown when *someone else* holds it; the "Claimed by"
  column names them and when they started.

### Working a task end to end

1. Scan from the top — Urgent and in-progress work floats up. Your own claimed
   tasks sort above everyone else's.
2. Optionally hit **View** to check the booking or customer first.
3. Press **Start**. You claim the task and land on the right screen
   (check-out, check-in, inspection, settle, etc.).
4. Do the work. When you complete the underlying action, the task **auto-closes** —
   you don't tick it off manually.
5. If you stepped away and came back, use **Continue** (in the row or the
   "work in progress" banner) to return to where you were.

### Finishing without the normal flow

- **Done** (in the work-in-progress banner) marks your claimed task complete
  manually. Use this only when the work is genuinely finished but didn't auto-close.
- **Abandon** releases the task back to the pool. You must give a reason of at least
  **5 characters** (e.g. "Customer no-show", "Waiting on parts") — managers review
  these to spot recurring blockers. Managers and above can tick **Force-abandon** to
  release a task claimed by someone else.

### How tasks close

| Outcome | When |
|---|---|
| **Completed** | The claimant finished the underlying work, or pressed **Done**. |
| **Superseded** | The work got done by someone other than the claimant, or the entity went terminal (e.g. the booking was cancelled). |
| **Abandoned** | Released via **Abandon**, force-abandoned by a manager, or auto-released after going stale (see below). |

### Stale-claim auto-release

If a claimed task gets no activity for **4 hours** (your browser is closed, you went
home), a background job flips it to **Abandoned** with the note
"No heartbeat for 240 minutes" so the work returns to the pool. While the
work-in-progress banner is open it sends a heartbeat every 60 seconds, so a task you
actually have open won't be reclaimed out from under you.

## Reading the stats cards

Four cards sit above the Queue table and summarise the *currently visible* tasks
(after your filters):

| Card | Shows |
|---|---|
| **Open tasks** | Total count, split into In progress (with "N yours") vs Unclaimed. |
| **By priority** | A stacked bar and counts across Urgent / High / Medium / Low. |
| **Claim mix** | A donut of Mine / Others' / Unclaimed. |
| **Queue age** | How long tasks have waited: Fresh (<1h), Recent (1–4h), Stale (4–24h), Critical (>24h). |

A rising Critical band or a growing total is worth raising with a manager — it
usually means a process needs attention, not just more clicking.

## Filtering the queue

- **Priority** — narrow to a single tier (All / Urgent / High / Medium / Low).
- **Only show tasks claimed by me** — focus on your own in-progress work.

Filters are reflected in the URL, so you can bookmark or share a filtered view.

## History tab

History lists closed task activity so managers can see throughput and where time
goes. It is **cross-depot on purpose** — any staff member can see team productivity;
the depot filter narrows rather than scopes.

![The History tab: summary cards for Closed in range, Cycle time, Slowest types and Top resolvers; Range, Outcome, Type and Search filters; and a table of closed tasks showing type, outcome badge (Completed / Abandoned / Superseded), who closed it and when, plus Queue wait, Work time and Total cycle columns and the closing note.](/help/priority-tasks/history-tab.png)

Controls:

- **Range** — Last 24 hours / 7 days / 30 days / 90 days (default 7 days).
- **Outcome** — All / Completed / Abandoned / Superseded.
- **Type** — any single task type.
- **Search** — free-text match on the closing note.

Each row shows the type, outcome badge, who closed it and when, plus three timing
columns (sortable):

| Column | Measures |
|---|---|
| **Queue wait** | From when the task became actionable to when it was claimed. |
| **Work time** | From claim to close (how long the staff member was on it). |
| **Total cycle** | From actionable to close (end-to-end). |

Queue wait and Total cycle are blank for older rows where the actionable time wasn't
captured at claim. A summary roll-up sits above the table for the whole filtered set.

## Worked example

A booking is due back at 14:00. At 12:30 a **Booking return** task appears tiered
**Medium**; from 12:00 onward (within 2 hours of the 14:00 due time) it would show
as **High**. The customer arrives at 14:05. Priya hits **Start**, claiming the task
and landing on the [check-in flow](/staff/help/check-in-workflow). She inspects the
bike and settles the return; the task **auto-closes** as Completed — no manual tick.
In History it records her **work time** (claim → close, say ~12 minutes) and the
**total cycle** measured from the return's due time. Had the customer not shown and
Priya pressed **Abandon** with reason "Customer no-show", the task would close as
**Abandoned** and drop back into the pool for the next shift.

## Common issues / troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "This task has already been claimed by another staff member." | Someone clicked Start a moment before you. The list will refresh; pick another task. |
| A task vanished while I was reading it | A colleague handled it, or the booking changed state. The queue refreshes every 30s. |
| I can see a task but only a greyed-out **Claimed** button | It's claimed by someone else. Check the "Claimed by" column; a manager can Force-abandon if it's stuck. |
| Expected a licence-verify / bond-release task and it's not here | Those types aren't surfaced in the queue yet — action them from their own screens. |
| "Some collectors failed or timed out" note | A data source was slow on that refresh; reload to retry. The rest of the queue is still valid. |
| My claimed task disappeared overnight | Stale-claim auto-release after 4 hours with no heartbeat. Re-claim it from the queue. |

## Related

- [Operations dashboard](/staff/help/operations-dashboard) — the today view this queue complements.
- [Checking a vehicle out](/staff/help/check-out-workflow) and [Checking a vehicle in](/staff/help/check-in-workflow) — where pickup/return tasks land.
- [Inspections](/staff/help/inspections) · [Maintenance](/staff/help/maintenance) — where inspection and work-order tasks land.
- [Late returns & overdue](/staff/help/late-returns-and-overdue) — the policy behind overdue-chase tasks.
