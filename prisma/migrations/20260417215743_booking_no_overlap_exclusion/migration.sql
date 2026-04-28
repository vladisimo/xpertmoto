-- A1-b: belt-and-braces database-enforced protection against overlapping
-- bookings on the same vehicle. The application code already uses a
-- transaction-scoped advisory lock (see acquireAllocationLock in
-- src/server/services/availability.ts), but a bug in that code path — or
-- a direct INSERT from an unrelated process — could still create
-- overlapping rows. This constraint is the last line of defence.
--
-- The partial WHERE clause scopes the constraint to statuses that
-- actually hold a vehicle: CONFIRMED, CHECKED_OUT, ACTIVE, OVERDUE.
-- Cancelled / completed / no-show / quote rows can legitimately share
-- a timeframe with a future booking for the same vehicle.
--
-- Uses btree_gist to combine the equality operator on vehicleId (text)
-- with the overlap operator on a timestamp range. We use `tsrange`
-- (plain timestamp) rather than `tstzrange` because our Booking
-- timestamp columns are `timestamp(3)` without timezone — `tstzrange`
-- would need to convert to timestamptz via the session timezone and is
-- therefore STABLE, not IMMUTABLE, and Postgres rejects STABLE functions
-- in index expressions. `tsrange(timestamp, timestamp)` is IMMUTABLE
-- and indexable. Defaults to `[lower, upper)` bounds — a rental ending
-- at 11:00 and another starting at 11:00 is not a conflict. The 2-hour
-- buffer between bookings is applied at the application layer, not
-- at this DB constraint.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_no_overlap"
EXCLUDE USING gist (
  "vehicleId" WITH =,
  tsrange("pickupDateTime", "returnDateTime") WITH &&
)
WHERE (
  "vehicleId" IS NOT NULL
  AND "status" IN ('CONFIRMED', 'CHECKED_OUT', 'ACTIVE', 'OVERDUE')
);
