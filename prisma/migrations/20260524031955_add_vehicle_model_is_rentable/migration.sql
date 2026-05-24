-- AlterTable
ALTER TABLE "VehicleModel" ADD COLUMN     "isRentable" BOOLEAN NOT NULL DEFAULT true;

-- Flag known internal/service vehicles (delivery vans) as non-rentable so they
-- never surface on consumer fleet/booking pages. Matches the seed-snapshot
-- durability step in prisma/seed-snapshot.ts.
UPDATE "VehicleModel"
SET "isRentable" = false
WHERE (lower("make"), lower("model")) IN
  (('ford', 'transit connect'), ('renault', 'master'));
