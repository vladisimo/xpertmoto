-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CustomerDocumentType" ADD VALUE 'CONSENT_TERMS';
ALTER TYPE "CustomerDocumentType" ADD VALUE 'CONSENT_PRIVACY';
ALTER TYPE "CustomerDocumentType" ADD VALUE 'CONSENT_CANCELLATION';
ALTER TYPE "CustomerDocumentType" ADD VALUE 'CONSENT_MARKETING';
ALTER TYPE "CustomerDocumentType" ADD VALUE 'CUSTOMER_PHOTO';
