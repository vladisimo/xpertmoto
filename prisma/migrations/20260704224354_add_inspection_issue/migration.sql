-- CreateEnum
CREATE TYPE "VehicleSide" AS ENUM ('FRONT', 'REAR', 'LEFT', 'RIGHT', 'TOP', 'OTHER');

-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR');

-- AlterTable
ALTER TABLE "DamageCharge" ADD COLUMN     "inspectionIssueId" TEXT;

-- CreateTable
CREATE TABLE "InspectionIssue" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "inspectionPhotoId" TEXT,
    "side" "VehicleSide",
    "damageTariffId" TEXT,
    "label" TEXT NOT NULL,
    "severity" "DamageSeverity" NOT NULL DEFAULT 'MINOR',
    "note" TEXT,
    "posX" DOUBLE PRECISION,
    "posY" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'staff',
    "isPreExisting" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InspectionIssue_inspectionId_idx" ON "InspectionIssue"("inspectionId");

-- CreateIndex
CREATE INDEX "InspectionIssue_inspectionPhotoId_idx" ON "InspectionIssue"("inspectionPhotoId");

-- CreateIndex
CREATE INDEX "InspectionIssue_damageTariffId_idx" ON "InspectionIssue"("damageTariffId");

-- CreateIndex
CREATE INDEX "DamageCharge_inspectionIssueId_idx" ON "DamageCharge"("inspectionIssueId");

-- AddForeignKey
ALTER TABLE "InspectionIssue" ADD CONSTRAINT "InspectionIssue_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionIssue" ADD CONSTRAINT "InspectionIssue_inspectionPhotoId_fkey" FOREIGN KEY ("inspectionPhotoId") REFERENCES "InspectionPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionIssue" ADD CONSTRAINT "InspectionIssue_damageTariffId_fkey" FOREIGN KEY ("damageTariffId") REFERENCES "DamageTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_inspectionIssueId_fkey" FOREIGN KEY ("inspectionIssueId") REFERENCES "InspectionIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
