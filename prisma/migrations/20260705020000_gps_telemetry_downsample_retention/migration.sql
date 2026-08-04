-- GPS telemetry long-term storage policy: downsample + retain.
--
-- The VehicleTelemetry hypertable accrues full-fidelity fixes forever. At 300+
-- vehicles over years that is unbounded storage and progressively slower
-- long-range reads. This migration bounds it:
--   1. A 1-minute continuous aggregate (VehicleTelemetry_1m) keeps a downsampled
--      copy of history FOREVER — near-lossless at the 60s poll cadence.
--   2. A 12-month retention policy drops raw fixes once they age out; the rollup
--      survives, so multi-year history is preserved at reduced resolution.
--
-- Hand-written raw SQL (Prisma does not model Timescale caggs/policies). Uses
-- only community-edition functions (time_bucket, first/last, add_*_policy) — no
-- timescaledb_toolkit. NEVER let a generated migration drop/recreate the cagg or
-- the hypertable; roll forward with new raw SQL instead.

-- ---------------------------------------------------------------------------
-- 1. 1-minute continuous aggregate. WITH NO DATA so the migration does not
--    materialise all existing history synchronously (the policy backfills).
--    `last(col, timestamp)` = the representative fix at bucket end.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS "VehicleTelemetry_1m"
WITH (timescaledb.continuous) AS
SELECT
    "deviceId",
    time_bucket(INTERVAL '1 minute', "timestamp") AS "bucket",
    last("vehicleId", "timestamp")  AS "vehicleId",
    last("latitude", "timestamp")   AS "latitude",
    last("longitude", "timestamp")  AS "longitude",
    avg("speedKph")                 AS "avgSpeedKph",
    max("speedKph")                 AS "maxSpeedKph",
    last("odometerKm", "timestamp") AS "odometerKm",
    last("batteryPct", "timestamp") AS "batteryPct",
    bool_or("ignitionOn")           AS "ignitionOn",
    count(*)                        AS "fixCount"
FROM "VehicleTelemetry"
GROUP BY "deviceId", "bucket"
WITH NO DATA;

-- Refresh policy: re-materialise the trailing window hourly. start_offset (3d)
-- comfortably covers the nightly querytracks sync, which back-writes up to ~24h
-- of fixes; end_offset (1h) leaves the freshest data to live reads on raw.
SELECT add_continuous_aggregate_policy(
    '"VehicleTelemetry_1m"',
    start_offset      => INTERVAL '3 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => TRUE
);

-- Compress the rollup too — it is kept forever, so old buckets should be
-- columnar. Segment by device, default order by bucket DESC.
ALTER MATERIALIZED VIEW "VehicleTelemetry_1m" SET (
    timescaledb.compress = TRUE,
    timescaledb.compress_segmentby = '"deviceId"'
);

SELECT add_compression_policy('"VehicleTelemetry_1m"', INTERVAL '30 days', if_not_exists => TRUE);

-- ---------------------------------------------------------------------------
-- 2. Retention on raw fixes. Drops whole chunks older than 12 months. By then
--    the rollup has long been materialised (refresh runs hourly), so no history
--    is lost — only full-resolution detail beyond the retention window.
-- ---------------------------------------------------------------------------
SELECT add_retention_policy('"VehicleTelemetry"', INTERVAL '12 months', if_not_exists => TRUE);
