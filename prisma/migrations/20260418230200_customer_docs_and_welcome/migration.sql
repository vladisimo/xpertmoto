-- CreateEnum
CREATE TYPE "CustomerDocumentType" AS ENUM ('PASSPORT', 'LICENCE_FRONT', 'LICENCE_BACK', 'VISA', 'INTL_DRIVING_PERMIT', 'PROOF_OF_ADDRESS', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CUSTOMER_WELCOME';

-- AlterTable
ALTER TABLE "CustomerProfile"
    ADD COLUMN "passportNumber" TEXT,
    ADD COLUMN "passportCountry" TEXT,
    ADD COLUMN "passportExpiry" DATE,
    ADD COLUMN "passportImage" TEXT,
    ADD COLUMN "emergencyContactRelationship" TEXT,
    ADD COLUMN "termsAcceptedAt" TIMESTAMPTZ,
    ADD COLUMN "termsVersion" TEXT,
    ADD COLUMN "privacyAcceptedAt" TIMESTAMPTZ,
    ADD COLUMN "privacyVersion" TEXT;

-- CreateTable
CREATE TABLE "CustomerDocument" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CustomerDocumentType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "label" TEXT,
    "expiryDate" DATE,
    "uploadedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerDocument_customerId_idx" ON "CustomerDocument"("customerId");

-- CreateIndex
CREATE INDEX "CustomerDocument_type_idx" ON "CustomerDocument"("type");

-- CreateIndex
CREATE INDEX "CustomerDocument_expiryDate_idx" ON "CustomerDocument"("expiryDate");

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
