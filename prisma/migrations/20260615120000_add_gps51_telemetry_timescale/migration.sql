-- GPS51 live tracking: TimescaleDB hypertable for telemetry history + the
-- live-position and sync-log tables. Hand-written (raw SQL) because Prisma does
-- not model Timescale hypertables/compression; see prisma/CLAUDE.md for the
-- raw-SQL migration precedent (pg_trgm, exclusion constraints).
--
-- Requires a TimescaleDB-capable Postgres (CREATE EXTENSION below). Local dev
-- runs the timescale/timescaledb-ha:pg16 container; prod must use a
-- Timescale-capable instance (not vanilla RDS).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------------
-- VehicleLivePosition: one row per tracker device (latest fix + movement
-- watermark). Powers the live fleet map without touching the hypertable.
-- ---------------------------------------------------------------------------
CREATE TABLE "VehicleLivePosition" (
    "deviceId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKph" DOUBLE PRECISION,
    "headingDeg" DOUBLE PRECISION,
    "ignitionOn" BOOLEAN,
    "batteryPct" DOUBLE PRECISION,
    "moving" BOOLEAN,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "histLat" DOUBLE PRECISION,
    "histLon" DOUBLE PRECISION,
    "histAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleLivePosition_pkey" PRIMARY KEY ("deviceId")
);

CREATE UNIQUE INDEX "VehicleLivePosition_vehicleId_key" ON "VehicleLivePosition"("vehicleId");
CREATE INDEX "VehicleLivePosition_vehicleId_idx" ON "VehicleLivePosition"("vehicleId");

ALTER TABLE "VehicleLivePosition"
    ADD CONSTRAINT "VehicleLivePosition_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Gps51Sync: run-log for the poll job (mirrors LinktSync). `cursor` persists
-- the GPS51 lastquerypositiontime between runs.
-- ---------------------------------------------------------------------------
CREATE TYPE "Gps51SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

CREATE TABLE "Gps51Sync" (
    "id" TEXT NOT NULL,
    "status" "Gps51SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "devicesSeen" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "cursor" BIGINT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gps51Sync_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Gps51Sync_createdAt_idx" ON "Gps51Sync"("createdAt");

-- ---------------------------------------------------------------------------
-- VehicleTelemetry -> TimescaleDB hypertable.
-- Timescale requires the partition column (timestamp) in every unique key, so
-- the PK becomes composite (deviceId, timestamp). That same key is the GPS51
-- ingest dedup key (ON CONFLICT DO NOTHING). `id` is kept as a plain column.
-- ---------------------------------------------------------------------------
ALTER TABLE "VehicleTelemetry" DROP CONSTRAINT IF EXISTS "VehicleTelemetry_pkey";
DROP INDEX IF EXISTS "VehicleTelemetry_deviceId_timestamp_idx";

-- De-dupe any pre-existing rows that would violate the new composite PK
-- (keeps the earliest-inserted row per (deviceId, timestamp)).
DELETE FROM "VehicleTelemetry" a
USING "VehicleTelemetry" b
WHERE a.ctid > b.ctid
  AND a."deviceId" = b."deviceId"
  AND a."timestamp" = b."timestamp";

ALTER TABLE "VehicleTelemetry"
    ADD CONSTRAINT "VehicleTelemetry_pkey" PRIMARY KEY ("deviceId", "timestamp");

-- Convert to a hypertable (7-day chunks). migrate_data moves any existing rows
-- into chunks; on a fresh DB the table is empty so this is a no-op.
SELECT create_hypertable(
    '"VehicleTelemetry"',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    migrate_data => TRUE,
    if_not_exists => TRUE
);

-- Columnar compression: segment by device, order by time. Compress chunks
-- older than 14 days (~10-20x). No retention policy — kept for years.
ALTER TABLE "VehicleTelemetry" SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = '"deviceId"',
    timescaledb.compress_orderby = '"timestamp" DESC'
);

SELECT add_compression_policy('"VehicleTelemetry"', INTERVAL '14 days', if_not_exists => TRUE);
