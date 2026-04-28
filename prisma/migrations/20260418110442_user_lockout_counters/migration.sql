-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_OVERAGE';

-- DropIndex (IF EXISTS — migration was recorded with drops that precede the
-- creates in the replay order; making them idempotent keeps the shadow db
-- happy without changing the applied-production outcome).
DROP INDEX IF EXISTS "Booking_bookingReference_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "User_email_idx";

-- DropIndex
DROP INDEX IF EXISTS "User_email_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "User_firstName_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "User_lastName_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "User_phone_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "Vehicle_internalCode_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "Vehicle_make_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "Vehicle_model_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "Vehicle_rego_trgm_idx";

-- AlterTable (DROP DEFAULT guarded: `updatedAt` is added by earlier
-- migrations with a default, then tightened here; replay order is brittle
-- for the shadow db, so each statement is defensive).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Addon' AND column_name='updatedAt') THEN
    ALTER TABLE "Addon" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ApiKey' AND column_name='updatedAt') THEN
    ALTER TABLE "ApiKey" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CreditNote' AND column_name='updatedAt') THEN
    ALTER TABLE "CreditNote" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CustomerProfile' AND column_name='updatedAt') THEN
    ALTER TABLE "CustomerProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='DepotOperatingHours' AND column_name='updatedAt') THEN
    ALTER TABLE "DepotOperatingHours" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Discount' AND column_name='updatedAt') THEN
    ALTER TABLE "Discount" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Infringement' AND column_name='updatedAt') THEN
    ALTER TABLE "Infringement" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='InsuranceOption' AND column_name='updatedAt') THEN
    ALTER TABLE "InsuranceOption" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='MaintenanceSchedule' AND column_name='updatedAt') THEN
    ALTER TABLE "MaintenanceSchedule" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Package' AND column_name='updatedAt') THEN
    ALTER TABLE "Package" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Payment' AND column_name='updatedAt') THEN
    ALTER TABLE "Payment" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Season' AND column_name='updatedAt') THEN
    ALTER TABLE "Season" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='StaffProfile' AND column_name='updatedAt') THEN
    ALTER TABLE "StaffProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='VehicleDocument' AND column_name='updatedAt') THEN
    ALTER TABLE "VehicleDocument" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='VehicleTransfer' AND column_name='updatedAt') THEN
    ALTER TABLE "VehicleTransfer" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastFailedLoginAt" TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMPTZ;
