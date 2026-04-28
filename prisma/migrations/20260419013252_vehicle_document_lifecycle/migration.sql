-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VehicleDocumentType" ADD VALUE 'WARRANTY';
ALTER TYPE "VehicleDocumentType" ADD VALUE 'INFRINGEMENT';
ALTER TYPE "VehicleDocumentType" ADD VALUE 'REPAIR_BILL';
ALTER TYPE "VehicleDocumentType" ADD VALUE 'PARTS_PURCHASE';
ALTER TYPE "VehicleDocumentType" ADD VALUE 'SERVICE_FEE';
ALTER TYPE "VehicleDocumentType" ADD VALUE 'TYRE_REPLACEMENT';

-- DropIndex
DROP INDEX "User_email_idx";

-- AlterTable
ALTER TABLE "Addon" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CreditNote" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DepotOperatingHours" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Discount" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Infringement" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InsuranceOption" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MaintenanceSchedule" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Package" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Season" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StaffProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VehicleDocument" ADD COLUMN     "cost" DECIMAL(10,2),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "issueDate" DATE,
ADD COLUMN     "referenceNumber" TEXT,
ADD COLUMN     "relatedInfringementId" TEXT,
ADD COLUMN     "relatedWorkOrderId" TEXT,
ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VehicleTransfer" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "VehicleDocument_relatedWorkOrderId_idx" ON "VehicleDocument"("relatedWorkOrderId");

-- CreateIndex
CREATE INDEX "VehicleDocument_relatedInfringementId_idx" ON "VehicleDocument"("relatedInfringementId");

-- CreateIndex
CREATE INDEX "VehicleDocument_vehicleId_createdAt_idx" ON "VehicleDocument"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleDocument_deletedAt_idx" ON "VehicleDocument"("deletedAt");

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_relatedWorkOrderId_fkey" FOREIGN KEY ("relatedWorkOrderId") REFERENCES "MaintenanceWorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDocument" ADD CONSTRAINT "VehicleDocument_relatedInfringementId_fkey" FOREIGN KEY ("relatedInfringementId") REFERENCES "Infringement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
