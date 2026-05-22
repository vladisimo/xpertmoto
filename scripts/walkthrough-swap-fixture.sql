-- Walkthrough fixture for the mid-rental swap wizard.
--
-- Creates ONE synthetic ACTIVE booking against existing Depot / User /
-- VehicleCategory / Vehicle rows in this database. Nothing else is
-- modified — 355 vehicles and 4,557 users remain untouched except for
-- the one vehicle that flips AVAILABLE → RENTED.
--
-- Idempotent: `ON CONFLICT DO NOTHING` on the Booking reference, and the
-- vehicle status change is gated on its current AVAILABLE state so a
-- re-run is a no-op.
--
-- Clean up when you're done (also restores the vehicle):
--   DELETE FROM "Booking" WHERE "bookingReference" = 'WALKTHROUGH-SWAP-001';
--   UPDATE "Vehicle" SET status = 'AVAILABLE'
--     WHERE "internalCode" = 'MTB-13429' AND status = 'RENTED';

BEGIN;

-- Pin the IDs we'll use so the script is deterministic.
--   Depot          : XPERT Moto Lewisham
--   Category       : LAMS Motorcycle (cat-A for the swap — upgrade target
--                    is "Unrestricted Motorcycle")
--   Customer       : vladisimo@gmail.com
--   Vehicle (out)  : MTB-13429 — AZJ57
WITH refs AS (
  SELECT
    (SELECT id FROM "Depot" WHERE name = 'XPERT Moto Lewisham')               AS depot_id,
    (SELECT id FROM "VehicleCategory" WHERE name = 'LAMS Motorcycle')         AS category_id,
    (SELECT id FROM "User" WHERE email = 'vladisimo@gmail.com')               AS customer_id,
    (SELECT id FROM "Vehicle" WHERE "internalCode" = 'MTB-13429')             AS vehicle_id
)
INSERT INTO "Booking" (
  id,
  "bookingReference",
  "customerId",
  "vehicleId",
  "categoryId",
  "depotId",
  "pickupDepotId",
  "returnDepotId",
  status,
  source,
  "pickupDateTime",
  "returnDateTime",
  "actualPickupDateTime",
  "durationDays",
  subtotal,
  "discountAmount",
  "addonTotal",
  "insuranceTotal",
  "bondAmount",
  "gstAmount",
  "totalAmount",
  "amountPaid",
  "balanceDue",
  "payOnlineAmount",
  "pricingSnapshot",
  "agreedToTerms",
  "customerIdVerified",
  "licenceVerified",
  "yieldMultiplier",
  "createdAt",
  "updatedAt"
)
SELECT
  'wlkt_swap_000000000000001',
  'WALKTHROUGH-SWAP-001',
  refs.customer_id,
  refs.vehicle_id,
  refs.category_id,
  refs.depot_id,
  refs.depot_id,
  refs.depot_id,
  'ACTIVE',
  'WALK_IN',
  NOW() - INTERVAL '2 days',
  NOW() + INTERVAL '3 days',
  NOW() - INTERVAL '2 days',
  5,
  345.00,   -- 5 × $69/day
  0,
  0,
  0,
  500.00,   -- LAMS bond
  31.36,    -- GST = 345/11
  345.00,
  345.00,
  0,
  0,
  '{}'::jsonb,
  true,
  true,
  true,
  1,
  NOW(),
  NOW()
FROM refs
WHERE refs.customer_id IS NOT NULL
  AND refs.vehicle_id IS NOT NULL
ON CONFLICT ("bookingReference") DO NOTHING;

-- Flip the chosen vehicle to RENTED and log the transition. Guarded on
-- the current status so re-runs don't double-log.
WITH v AS (
  SELECT id, status FROM "Vehicle" WHERE "internalCode" = 'MTB-13429'
)
UPDATE "Vehicle"
SET status = 'RENTED', "updatedAt" = NOW()
WHERE id = (SELECT id FROM v) AND (SELECT status FROM v) = 'AVAILABLE';

INSERT INTO "VehicleStatusLog" (id, "vehicleId", "previousStatus", "newStatus", reason, timestamp)
SELECT
  'wlkt_swap_vslog_000000001',
  v.id,
  'AVAILABLE',
  'RENTED',
  'Walkthrough fixture — booking WALKTHROUGH-SWAP-001',
  NOW()
FROM "Vehicle" v
WHERE v."internalCode" = 'MTB-13429'
  AND v.status = 'RENTED'
ON CONFLICT (id) DO NOTHING;

-- Echo the result so you can jump straight to the wizard.
SELECT
  b.id AS booking_id,
  b."bookingReference",
  b.status,
  v."internalCode" AS current_vehicle,
  v.rego,
  '/staff/bookings/' || b.id || '/swap' AS wizard_url
FROM "Booking" b
JOIN "Vehicle" v ON v.id = b."vehicleId"
WHERE b."bookingReference" = 'WALKTHROUGH-SWAP-001';

COMMIT;
