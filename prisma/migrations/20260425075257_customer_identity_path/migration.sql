-- Adds the `LicenceType` enum and the new `licenceType` / `licenceCountry`
-- columns on `CustomerProfile`. Drives the AU-licence-vs-International-
-- Driver's-Permit gate in the customer booking wizard (Step 4), behind
-- the `wizard_intl_licence_flow` feature flag.

-- CreateEnum
CREATE TYPE "LicenceType" AS ENUM ('AU_LICENCE', 'INTERNATIONAL');

-- AlterTable
ALTER TABLE "CustomerProfile"
  ADD COLUMN "licenceType" "LicenceType",
  ADD COLUMN "licenceCountry" TEXT;

-- Backfill: rows with a populated licenceState are Australian licences
-- under the pre-refactor policy, so tag them AU_LICENCE. Rows with only
-- passport data are left NULL so the UI re-asks the gate on next booking.
UPDATE "CustomerProfile"
   SET "licenceType" = 'AU_LICENCE'
 WHERE "licenceType" IS NULL
   AND "licenceState" IS NOT NULL;
