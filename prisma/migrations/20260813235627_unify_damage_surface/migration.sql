-- DropForeignKey
ALTER TABLE "DamageCharge" DROP CONSTRAINT "DamageCharge_inspectionId_fkey";

-- AlterTable
ALTER TABLE "DamageCharge" ADD COLUMN     "incidentId" TEXT,
ALTER COLUMN "returnAssessmentId" DROP NOT NULL,
ALTER COLUMN "inspectionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "DamageCharge_incidentId_idx" ON "DamageCharge"("incidentId");

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A charge must be parented by a return assessment OR an incident. (An
-- incident hard-delete that would orphan a money row fails this CHECK on
-- the SET NULL — intended: incidents are soft-deleted in practice.)
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_parent_chk"
  CHECK ("returnAssessmentId" IS NOT NULL OR "incidentId" IS NOT NULL);
