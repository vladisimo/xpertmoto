-- Passport parity migration (Phase 1 of the passport-identity-documents work).
--
-- Schema deltas:
--   1. CustomerProfile: add passportVerifiedAt / passportVerifiedById
--      (mirrors licenceVerifiedAt/ById).
--   2. CustomerDocument: add the composite index used by the new
--      applyLatestDocumentToProfile service — "newest row per (customer, type)".
--   3. NotificationType enum: add PASSPORT_EXPIRING for the rename of the
--      licence-expiry job into a generic identity-document-expiry job.
--
-- Drift correction (included for correctness — pre-existing gap not caused by
-- this change): CustomerDocument.metadata was present in the Prisma schema but
-- missing from the DB. Adding it here with IF NOT EXISTS so environments that
-- previously received it via `db push` don't error.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PASSPORT_EXPIRING';

-- AlterTable
ALTER TABLE "CustomerDocument" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN IF NOT EXISTS "passportVerifiedAt" TIMESTAMPTZ,
                              ADD COLUMN IF NOT EXISTS "passportVerifiedById" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomerDocument_customerId_type_createdAt_idx"
    ON "CustomerDocument" ("customerId", "type", "createdAt" DESC);
