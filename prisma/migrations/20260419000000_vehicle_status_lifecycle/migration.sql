-- Vehicle status lifecycle reshape.
--
-- Splits the legacy `DECOMMISSIONED` bucket into explicit `SOLD` and
-- `END_OF_LIFE` statuses, and introduces `PENDING` (fleet intake, not yet
-- bookable) and `ACCIDENT_REPAIRS` (off-road for damage, distinct from
-- routine `IN_MAINTENANCE`). Operational statuses (`RENTED`, `RESERVED`,
-- `IN_TRANSIT`) are unchanged — they are set by the booking/transfer flow,
-- not by admins.
--
-- The enum is rebuilt rather than `ADD VALUE`'d because we also need to
-- drop `DECOMMISSIONED`. Existing rows are rewritten by consulting
-- `VehicleStatusLog.reason` for context: `SOLD` reason → `SOLD`, anything
-- else → `END_OF_LIFE`.

-- 1. Rename the existing enum so we can create the new one under the same name.
ALTER TYPE "VehicleStatus" RENAME TO "VehicleStatus_old";

-- 2. Create the replacement enum with the final member list.
CREATE TYPE "VehicleStatus" AS ENUM (
  'AVAILABLE',
  'PENDING',
  'RENTED',
  'RESERVED',
  'IN_MAINTENANCE',
  'ACCIDENT_REPAIRS',
  'IN_TRANSIT',
  'SOLD',
  'END_OF_LIFE',
  'STOLEN',
  'WRITTEN_OFF'
);

-- 3. Detach referencing columns from the old enum by casting to text, so
--    the DECOMMISSIONED rows can be rewritten before the new enum is applied.
ALTER TABLE "Vehicle" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Vehicle" ALTER COLUMN "status" TYPE text USING "status"::text;
ALTER TABLE "VehicleStatusLog" ALTER COLUMN "previousStatus" TYPE text USING "previousStatus"::text;
ALTER TABLE "VehicleStatusLog" ALTER COLUMN "newStatus" TYPE text USING "newStatus"::text;

-- 4. Rewrite any row holding the retired `DECOMMISSIONED` value.
--    For `Vehicle.status`, look up the most recent log entry for that
--    vehicle with newStatus='DECOMMISSIONED' and inspect its `reason`.
UPDATE "Vehicle" v
SET "status" = COALESCE(
  (
    SELECT CASE WHEN l."reason" = 'SOLD' THEN 'SOLD' ELSE 'END_OF_LIFE' END
    FROM "VehicleStatusLog" l
    WHERE l."vehicleId" = v."id"
      AND l."newStatus" = 'DECOMMISSIONED'
    ORDER BY l."timestamp" DESC
    LIMIT 1
  ),
  'END_OF_LIFE'
)
WHERE v."status" = 'DECOMMISSIONED';

-- For log rows recording a transition INTO DECOMMISSIONED, use the row's
-- own `reason` field directly.
UPDATE "VehicleStatusLog"
SET "newStatus" = CASE WHEN "reason" = 'SOLD' THEN 'SOLD' ELSE 'END_OF_LIFE' END
WHERE "newStatus" = 'DECOMMISSIONED';

-- For log rows whose previousStatus was DECOMMISSIONED, the reason on that
-- row describes the transition OUT, not IN, so fall back to END_OF_LIFE —
-- purely audit history, no behaviour hangs on it.
UPDATE "VehicleStatusLog"
SET "previousStatus" = 'END_OF_LIFE'
WHERE "previousStatus" = 'DECOMMISSIONED';

-- 5. Apply the new enum to every referencing column and restore the default.
ALTER TABLE "Vehicle" ALTER COLUMN "status" TYPE "VehicleStatus" USING "status"::"VehicleStatus";
ALTER TABLE "Vehicle" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
ALTER TABLE "VehicleStatusLog" ALTER COLUMN "previousStatus" TYPE "VehicleStatus" USING "previousStatus"::"VehicleStatus";
ALTER TABLE "VehicleStatusLog" ALTER COLUMN "newStatus" TYPE "VehicleStatus" USING "newStatus"::"VehicleStatus";

-- 6. Drop the old enum.
DROP TYPE "VehicleStatus_old";
