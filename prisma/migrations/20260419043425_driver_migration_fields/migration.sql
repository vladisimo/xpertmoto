-- AlterEnum: PASSPORT_STYLE_DL distinguishes overseas driver's-licence
-- passports (legacy "_dlpassport" files) from true travel passports.
ALTER TYPE "CustomerDocumentType" ADD VALUE IF NOT EXISTS 'PASSPORT_STYLE_DL';

-- AlterTable: legacy migration fields on User
ALTER TABLE "User" ADD COLUMN     "legacyDriverId" TEXT;
ALTER TABLE "User" ADD COLUMN     "legacyImportedAt" TIMESTAMPTZ;

-- CreateIndex
CREATE UNIQUE INDEX "User_legacyDriverId_key" ON "User"("legacyDriverId");

-- CreateIndex
CREATE INDEX "User_legacyImportedAt_idx" ON "User"("legacyImportedAt");

-- AlterTable: legacy migration fields on CustomerProfile
ALTER TABLE "CustomerProfile" ADD COLUMN     "secondaryPhone" TEXT;
ALTER TABLE "CustomerProfile" ADD COLUMN     "legacyReferralSource" TEXT;
ALTER TABLE "CustomerProfile" ADD COLUMN     "signatureImage" TEXT;
