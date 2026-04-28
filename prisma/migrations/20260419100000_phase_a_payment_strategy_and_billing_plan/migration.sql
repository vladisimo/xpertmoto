-- Phase A — per-category online payment strategy + progressive billing
-- for long-term hires. See plan notes and CLAUDE.md. Extends VehicleCategory
-- with strategy fields and introduces the BookingBillingPlan model that
-- drives recurring charges on long-term bookings via the
-- `booking-billing` job.

-- CreateEnum
CREATE TYPE "OnlinePaymentStrategy" AS ENUM ('FULL', 'FLAT', 'PERCENT', 'ZERO');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "BookingBillingStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "payOnlineAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VehicleCategory" ADD COLUMN     "bookingFeeFlat" DECIMAL(10,2),
ADD COLUMN     "bookingFeePercent" DECIMAL(5,2),
ADD COLUMN     "longTermDefaultFrequency" "BillingFrequency" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "longTermMinDays" INTEGER DEFAULT 14,
ADD COLUMN     "onlinePaymentStrategy" "OnlinePaymentStrategy" NOT NULL DEFAULT 'FULL';

-- CreateTable
CREATE TABLE "BookingBillingPlan" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "frequency" "BillingFrequency" NOT NULL,
    "amountPerPeriod" DECIMAL(10,2) NOT NULL,
    "gstPerPeriod" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "periodsTotal" INTEGER NOT NULL,
    "periodsCompleted" INTEGER NOT NULL DEFAULT 0,
    "nextChargeAt" TIMESTAMPTZ NOT NULL,
    "lastChargedAt" TIMESTAMPTZ,
    "chargesAttempted" INTEGER NOT NULL DEFAULT 0,
    "chargesSucceeded" INTEGER NOT NULL DEFAULT 0,
    "chargesFailed" INTEGER NOT NULL DEFAULT 0,
    "status" "BookingBillingStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripePaymentMethodId" TEXT,
    "pauseReason" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingBillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingBillingPlan_bookingId_key" ON "BookingBillingPlan"("bookingId");

-- CreateIndex
CREATE INDEX "BookingBillingPlan_status_nextChargeAt_idx" ON "BookingBillingPlan"("status", "nextChargeAt");

-- AddForeignKey
ALTER TABLE "BookingBillingPlan" ADD CONSTRAINT "BookingBillingPlan_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
