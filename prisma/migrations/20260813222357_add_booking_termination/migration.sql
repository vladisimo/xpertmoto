-- CreateEnum
CREATE TYPE "LossTerminationCause" AS ENUM ('WRITTEN_OFF', 'STOLEN', 'DESTROYED', 'OTHER');

-- CreateEnum
CREATE TYPE "TerminationRefundMode" AS ENUM ('REFUND', 'CREDIT', 'FORFEIT');

-- CreateEnum
CREATE TYPE "TerminationBondDisposition" AS ENUM ('RELEASED', 'HELD_FOR_CLAIM', 'CAPTURED_VIA_INCIDENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdjustmentReason" ADD VALUE 'TERMINATION';
ALTER TYPE "AdjustmentReason" ADD VALUE 'AMENDMENT';

-- AlterEnum
ALTER TYPE "SwapReason" ADD VALUE 'LOSS_REPLACEMENT';

-- CreateTable
CREATE TABLE "BookingTermination" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "incidentId" TEXT,
    "cause" "LossTerminationCause" NOT NULL,
    "lossAt" TIMESTAMPTZ NOT NULL,
    "unusedDays" INTEGER NOT NULL,
    "refundMode" "TerminationRefundMode" NOT NULL,
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "creditGiftCardId" TEXT,
    "waivedLateFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bondDisposition" "TerminationBondDisposition" NOT NULL,
    "notes" TEXT,
    "terminatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingTermination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingTermination_bookingId_key" ON "BookingTermination"("bookingId");

-- CreateIndex
CREATE INDEX "BookingTermination_incidentId_idx" ON "BookingTermination"("incidentId");

-- CreateIndex
CREATE INDEX "BookingTermination_terminatedById_idx" ON "BookingTermination"("terminatedById");

-- CreateIndex
CREATE INDEX "BookingTermination_cause_idx" ON "BookingTermination"("cause");

-- CreateIndex
CREATE INDEX "BookingTermination_creditGiftCardId_idx" ON "BookingTermination"("creditGiftCardId");

-- CreateIndex
CREATE INDEX "Incident_excessVoidedById_idx" ON "Incident"("excessVoidedById");

-- AddForeignKey
ALTER TABLE "BookingTermination" ADD CONSTRAINT "BookingTermination_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTermination" ADD CONSTRAINT "BookingTermination_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTermination" ADD CONSTRAINT "BookingTermination_terminatedById_fkey" FOREIGN KEY ("terminatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
