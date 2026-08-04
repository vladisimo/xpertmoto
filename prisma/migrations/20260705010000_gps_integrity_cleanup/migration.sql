-- GPS telemetry integrity + cleanup:
--   1. Enforce one tracker device ↔ at most one vehicle (data-integrity fix).
--   2. Drop the dead VehicleLivePosition.hist* watermark columns (never read
--      or written since history moved to the nightly querytracks sync).
-- Hand-written so the unique-index step can pre-check for existing duplicate
-- tracker IDs and fail with a clear, actionable message instead of Postgres's
-- opaque "could not create unique index" error.

-- ---------------------------------------------------------------------------
-- 1. Vehicle.gpsTrackerId — one device per vehicle.
-- ---------------------------------------------------------------------------
-- Pre-check: surface any pre-existing duplicates loudly. A duplicate means two
-- vehicles share a tracker; a human must decide which keeps it before this
-- migration can proceed (we cannot safely pick automatically).
DO $$
DECLARE
    dupes TEXT;
BEGIN
    SELECT string_agg("gpsTrackerId" || ' (×' || cnt || ')', ', ')
    INTO dupes
    FROM (
        SELECT "gpsTrackerId", COUNT(*) AS cnt
        FROM "Vehicle"
        WHERE "gpsTrackerId" IS NOT NULL AND "deletedAt" IS NULL
        GROUP BY "gpsTrackerId"
        HAVING COUNT(*) > 1
    ) d;

    IF dupes IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot add unique constraint: these gpsTrackerId values are assigned to more than one active vehicle: %. Reassign so each device maps to a single vehicle, then re-run the migration.',
            dupes;
    END IF;
END $$;

-- Nullable column → Postgres NULLS DISTINCT default lets many untracked
-- vehicles coexist; only non-null tracker IDs are constrained to be unique.
CREATE UNIQUE INDEX "Vehicle_gpsTrackerId_key" ON "Vehicle"("gpsTrackerId");

-- ---------------------------------------------------------------------------
-- 2. Drop dead watermark columns from VehicleLivePosition.
-- ---------------------------------------------------------------------------
ALTER TABLE "VehicleLivePosition" DROP COLUMN IF EXISTS "histLat";
ALTER TABLE "VehicleLivePosition" DROP COLUMN IF EXISTS "histLon";
ALTER TABLE "VehicleLivePosition" DROP COLUMN IF EXISTS "histAt";
