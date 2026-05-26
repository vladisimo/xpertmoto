-- Multi-axis bike classification (browse & filter only — never pricing).
-- Adds BikeType + RiderLevel taxonomies to VehicleModel and restructures
-- FleetUseCase down to the four pure use cases, migrating the two removed
-- values into the new axes. Order is load-bearing: backfill and scrub the
-- useCases arrays BEFORE recreating the FleetUseCase enum type.

-- 1. New taxonomy enums + array columns (non-destructive).
CREATE TYPE "BikeType" AS ENUM ('NAKED', 'SCOOTER', 'TOURING', 'SPORT', 'CRUISER', 'SUPER_SPORT');
CREATE TYPE "RiderLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

ALTER TABLE "VehicleModel"
  ADD COLUMN "bikeTypes" "BikeType"[] DEFAULT ARRAY[]::"BikeType"[],
  ADD COLUMN "riderLevels" "RiderLevel"[] DEFAULT ARRAY[]::"RiderLevel"[];

-- 2. Backfill from the soon-to-be-removed FleetUseCase values, while they
--    still exist on the type.
UPDATE "VehicleModel"
  SET "bikeTypes" = array_cat("bikeTypes", ARRAY['SPORT', 'CRUISER']::"BikeType"[])
  WHERE 'SPORT_CRUISER' = ANY("useCases");

UPDATE "VehicleModel"
  SET "riderLevels" = array_append("riderLevels", 'BEGINNER'::"RiderLevel")
  WHERE 'LEARNER_APPROVED' = ANY("useCases");

-- 3. Scrub the dead values out of useCases (Postgres refuses to drop an enum
--    value while any row still references it).
UPDATE "VehicleModel"
  SET "useCases" = array_remove(array_remove("useCases", 'SPORT_CRUISER'), 'LEARNER_APPROVED');

-- 4. Recreate FleetUseCase without the dead values (Postgres has no DROP VALUE;
--    the supported pattern is a type swap). The array column default references
--    the old type, so drop it before the cast and restore it after.
ALTER TYPE "FleetUseCase" RENAME TO "FleetUseCase_old";
CREATE TYPE "FleetUseCase" AS ENUM ('ADVENTURE', 'COMMUTING', 'PRACTICE', 'DELIVERY');

ALTER TABLE "VehicleModel" ALTER COLUMN "useCases" DROP DEFAULT;
ALTER TABLE "VehicleModel"
  ALTER COLUMN "useCases" TYPE "FleetUseCase"[]
  USING "useCases"::text[]::"FleetUseCase"[];
ALTER TABLE "VehicleModel" ALTER COLUMN "useCases" SET DEFAULT ARRAY[]::"FleetUseCase"[];

DROP TYPE "FleetUseCase_old";
