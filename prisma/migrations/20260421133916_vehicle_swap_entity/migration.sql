-- CreateEnum
CREATE TYPE "InspectionPurpose" AS ENUM ('CHECK_OUT', 'CHECK_IN', 'SWAP_OUT', 'SWAP_IN', 'ROUTINE', 'INCIDENT');

-- CreateEnum
CREATE TYPE "SwapReason" AS ENUM ('UPGRADE', 'DOWNGRADE', 'LATERAL', 'MECHANICAL_FAULT', 'ACCIDENT_DAMAGE', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "SwapOrigin" AS ENUM ('CUSTOMER_WALK_IN', 'CUSTOMER_PHONE_SUPPORT', 'CUSTOMER_SELF_SERVICE', 'ROADSIDE_ASSIST', 'STAFF_OBSERVED', 'TELEMATICS_ALERT');

-- CreateEnum
CREATE TYPE "BookingSwapStatus" AS ENUM ('DRAFT', 'COMMITTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SwapPriceDirection" AS ENUM ('NONE', 'CHARGE', 'REFUND');

-- AlterEnum
ALTER TYPE "PaymentType" ADD VALUE 'SWAP_ADJUSTMENT';

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "purpose" "InspectionPurpose" NOT NULL DEFAULT 'CHECK_OUT';

-- CreateTable
CREATE TABLE "BookingSwap" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "outgoingVehicleId" TEXT NOT NULL,
    "incomingVehicleId" TEXT,
    "swappedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "swappedById" TEXT NOT NULL,
    "reason" "SwapReason" NOT NULL,
    "origin" "SwapOrigin" NOT NULL,
    "reasonNotes" TEXT NOT NULL,
    "originDetails" TEXT,
    "priceAdjustmentAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "priceAdjustmentGst" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "priceAdjustmentDirection" "SwapPriceDirection" NOT NULL DEFAULT 'NONE',
    "paymentId" TEXT,
    "outgoingInspectionId" TEXT,
    "incomingInspectionId" TEXT,
    "workOrderId" TEXT,
    "incidentId" TEXT,
    "documentUrl" TEXT,
    "customerSignatureUrl" TEXT,
    "staffSignatureUrl" TEXT,
    "creditNoteId" TEXT,
    "bondVarianceAmount" DECIMAL(10,2),
    "status" "BookingSwapStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BookingSwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingSwap_paymentId_key" ON "BookingSwap"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSwap_outgoingInspectionId_key" ON "BookingSwap"("outgoingInspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSwap_incomingInspectionId_key" ON "BookingSwap"("incomingInspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSwap_workOrderId_key" ON "BookingSwap"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSwap_incidentId_key" ON "BookingSwap"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSwap_creditNoteId_key" ON "BookingSwap"("creditNoteId");

-- CreateIndex
CREATE INDEX "BookingSwap_bookingId_idx" ON "BookingSwap"("bookingId");

-- CreateIndex
CREATE INDEX "BookingSwap_outgoingVehicleId_idx" ON "BookingSwap"("outgoingVehicleId");

-- CreateIndex
CREATE INDEX "BookingSwap_incomingVehicleId_idx" ON "BookingSwap"("incomingVehicleId");

-- CreateIndex
CREATE INDEX "BookingSwap_status_createdAt_idx" ON "BookingSwap"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BookingSwap_reason_idx" ON "BookingSwap"("reason");

-- CreateIndex
CREATE INDEX "BookingSwap_deletedAt_idx" ON "BookingSwap"("deletedAt");

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_outgoingVehicleId_fkey" FOREIGN KEY ("outgoingVehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_incomingVehicleId_fkey" FOREIGN KEY ("incomingVehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_swappedById_fkey" FOREIGN KEY ("swappedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_outgoingInspectionId_fkey" FOREIGN KEY ("outgoingInspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_incomingInspectionId_fkey" FOREIGN KEY ("incomingInspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "MaintenanceWorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingSwap" ADD CONSTRAINT "BookingSwap_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
