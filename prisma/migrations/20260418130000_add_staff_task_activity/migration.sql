-- CreateEnum
CREATE TYPE "StaffTaskType" AS ENUM ('BOOKING_PICKUP', 'BOOKING_RETURN', 'BOOKING_OVERDUE_CHASE', 'INSPECTION_PRE_HIRE', 'INSPECTION_POST_HIRE', 'INSPECTION_FLAGGED_REVIEW', 'MAINTENANCE_WORK_ORDER', 'VEHICLE_REGO_ACTION', 'VEHICLE_CTP_ACTION', 'VEHICLE_INSURANCE_ACTION', 'VEHICLE_SERVICE_ACTION', 'VEHICLE_TYRE_ACTION', 'INCIDENT_TRIAGE', 'INCIDENT_INVESTIGATE', 'SUPPORT_TICKET_TRIAGE', 'SUPPORT_TICKET_RESPOND', 'CUSTOMER_LICENCE_VERIFY', 'RENTAL_AGREEMENT_SIGN', 'RETURN_ASSESSMENT_FINALISE', 'CALENDAR_ALLOCATION', 'DAMAGE_CHARGE_CONFIRM', 'INFRINGEMENT_NOMINATE', 'BOND_RELEASE_REVIEW');

-- CreateEnum
CREATE TYPE "StaffTaskTier" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "StaffTaskActivityStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "StaffTaskActivity" (
    "id" TEXT NOT NULL,
    "taskType" "StaffTaskType" NOT NULL,
    "targetEntityKind" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "depotId" TEXT,
    "tierSnapshot" "StaffTaskTier" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "status" "StaffTaskActivityStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTaskActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffTaskActivity_staffId_status_idx" ON "StaffTaskActivity"("staffId", "status");

-- CreateIndex
CREATE INDEX "StaffTaskActivity_taskType_targetEntityId_status_idx" ON "StaffTaskActivity"("taskType", "targetEntityId", "status");

-- CreateIndex
CREATE INDEX "StaffTaskActivity_startedAt_idx" ON "StaffTaskActivity"("startedAt");

-- CreateIndex
CREATE INDEX "StaffTaskActivity_completedAt_idx" ON "StaffTaskActivity"("completedAt");

-- CreateIndex
CREATE INDEX "StaffTaskActivity_status_lastHeartbeatAt_idx" ON "StaffTaskActivity"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "StaffTaskActivity_depotId_idx" ON "StaffTaskActivity"("depotId");

-- Partial unique index: only one IN_PROGRESS activity per (taskType, targetEntityId) at a time.
-- Prevents two staff members from claiming the same task simultaneously.
CREATE UNIQUE INDEX "StaffTaskActivity_single_inprogress"
  ON "StaffTaskActivity" ("taskType", "targetEntityId")
  WHERE status = 'IN_PROGRESS';

-- AddForeignKey
ALTER TABLE "StaffTaskActivity" ADD CONSTRAINT "StaffTaskActivity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
