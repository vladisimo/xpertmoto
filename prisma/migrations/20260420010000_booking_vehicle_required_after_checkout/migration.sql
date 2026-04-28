-- Guard: once a booking has reached a post-checkout status, it MUST have
-- a vehicle allocated. The check-out path (staffBooking.checkOut) always
-- writes vehicleId, but early seed scripts and manual SQL fixes could
-- leave post-checkout rows with a NULL vehicleId, which then breaks
-- downstream flows (post-hire inspection, settlement, invoicing).
--
-- Cleanup first: any row that violates the invariant today is malformed.
-- Demote it to CONFIRMED so the check-out flow can re-run against it
-- with a real vehicle allocation instead of silently skipping the step.

UPDATE "Booking"
  SET status = 'CONFIRMED'
WHERE "vehicleId" IS NULL
  AND status IN ('CHECKED_OUT', 'ACTIVE', 'OVERDUE', 'RETURNED', 'COMPLETED');

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_vehicle_required_after_checkout_chk"
  CHECK (
    status NOT IN ('CHECKED_OUT', 'ACTIVE', 'OVERDUE', 'RETURNED', 'COMPLETED')
    OR "vehicleId" IS NOT NULL
  );
