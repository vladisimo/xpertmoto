# Depots

Depots are your physical locations — the branches customers pick up from and
return to. Getting depot configuration right matters because availability,
allocation and pricing all depend on it.

## What you configure

- **Location** — address and map position for the public site.
- **Opening hours** — when pickups and returns can happen.
- **Depot-specific settings** — including any pricing overrides for that
  location (see **Pricing**).

## Why it matters

- **Availability** is calculated per depot — a vehicle is bookable at the depot
  it lives at, within its hours.
- **Allocation** assigns a specific unit at that depot at check-out.
- **Pricing** can be overridden per depot, so the same category can cost
  differently at different sites.

## Multi-depot note

If you operate across regions, be aware that scheduled jobs (overdue detection,
reminders, bond release) currently run on Australia/Brisbane time. For depots
outside south-east Queensland this is worth keeping in mind when reasoning about
exactly when an automated status change fires — raise it with a super admin if it
affects you.
