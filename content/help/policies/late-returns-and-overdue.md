# Late returns & overdue

When a vehicle comes back after its agreed return time, late fees apply and the
booking's status changes automatically. Here's how it works.

## The grace period

There's a **1-hour grace period** after the agreed return time. Return within
that hour and there's no late charge — it absorbs ordinary delays (traffic,
queues).

## Late fees after the grace period

Past the grace period, lateness is charged at an **hourly rate equal to the daily
rate divided by 8**, and that hourly accrual is **capped at the full daily rate
per day**. In other words, a very late return on a given day costs at most one
extra day's hire, not more.

- Example: a $80/day bike is $10/hour late ($80 ÷ 8). Three hours late = $30; but
  it can never exceed $80 for that day.

The system computes the late fee during **check-in settlement** — you don't work
the hours out by hand.

## Automatic OVERDUE status

A scheduled job runs every **15 minutes** and flags hires that have passed their
return time as **OVERDUE**, so they surface on the Operations dashboard and in
the task queue without anyone watching the clock.

> Note: scheduled jobs run on Australia/Brisbane time. For depots outside SE
> Queensland, this affects exactly when the status flips — worth knowing when
> reasoning about edge cases near the return time.

## For staff

- Work **Overdue** on the dashboard first — every overdue hire is a tied-up
  vehicle and unbilled time.
- Late fees are taken at settlement, against payment or the **bond**.
- Chasing early (a friendly reminder as the return time nears) prevents most
  overdues turning into problems.
