-- CreateEnum
CREATE TYPE "BasePeriodHours" AS ENUM ('H24', 'H48');

-- CreateEnum
CREATE TYPE "TierMode" AS ENUM ('PROGRESSIVE', 'PER_WEEK');

-- AlterTable
ALTER TABLE "PricingTier" ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "pricePerWeek" DECIMAL(10,2),
ADD COLUMN     "tierMode" "TierMode" NOT NULL DEFAULT 'PROGRESSIVE',
ALTER COLUMN "tierTotal" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "basePeriodHoursOverride" "BasePeriodHours",
ADD COLUMN     "baseRateOverride" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "VehicleModel" ADD COLUMN     "basePeriodHours" "BasePeriodHours" DEFAULT 'H24',
ADD COLUMN     "baseRate" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "PricingTier_modelId_minDays_idx" ON "PricingTier"("modelId", "minDays");

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce exactly one scope per PricingTier row: categoryId | modelId | vehicleId.
-- Existing rows (categoryId xor vehicleId) satisfy this; newly added modelId
-- joins the mutual-exclusion group. The CHECK is NOT VALID-free (DEFERRABLE
-- is not needed for a row-level constraint) and Postgres-portable.
ALTER TABLE "PricingTier"
  ADD CONSTRAINT "PricingTier_exactly_one_scope"
  CHECK (
    (("categoryId" IS NOT NULL)::int + ("modelId" IS NOT NULL)::int + ("vehicleId" IS NOT NULL)::int) = 1
  );

-- Enforce per-row pricing-mode integrity:
-- - PROGRESSIVE rows price off tierTotal (must be >= 0; pricePerWeek must be NULL)
-- - PER_WEEK    rows price off pricePerWeek (must be NOT NULL and > 0)
ALTER TABLE "PricingTier"
  ADD CONSTRAINT "PricingTier_mode_fields_consistent"
  CHECK (
    ("tierMode" = 'PROGRESSIVE' AND "pricePerWeek" IS NULL)
    OR
    ("tierMode" = 'PER_WEEK' AND "pricePerWeek" IS NOT NULL AND "pricePerWeek" > 0)
  );
