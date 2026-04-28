-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'SIGNED', 'SUPERSEDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('DRAFT', 'SIGNED', 'FINALISED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ChargeResolution" AS ENUM ('STANDARD', 'QUOTE_PENDING', 'WAIVED', 'WARRANTY');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PROVISIONAL', 'CONFIRMED', 'CAPTURED', 'WAIVED');

-- CreateEnum
CREATE TYPE "TimestampStatus" AS ENUM ('PENDING', 'OK', 'FAILED');

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "customerAckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MaintenanceWorkOrder" ADD COLUMN     "relatedDamageChargeId" TEXT;

-- CreateTable
CREATE TABLE "RentalAgreement" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "agreementNumber" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "termsVersion" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "customerSignatureUrl" TEXT,
    "customerInitialsUrl" TEXT,
    "staffSignatureUrl" TEXT,
    "staffId" TEXT,
    "pdfUrl" TEXT,
    "pdfKey" TEXT,
    "contentSnapshot" JSONB NOT NULL DEFAULT '{}',
    "pagesInitialled" JSONB NOT NULL DEFAULT '[]',
    "timestampTokenKey" TEXT,
    "timestampTsaUrl" TEXT,
    "timestampSerial" TEXT,
    "timestampStatus" "TimestampStatus" NOT NULL DEFAULT 'PENDING',
    "timestampedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "supersededReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnAssessment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "assessmentNumber" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "contentSnapshot" JSONB NOT NULL DEFAULT '{}',
    "pagesInitialled" JSONB NOT NULL DEFAULT '[]',
    "lateFeeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fuelChargeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "damageChargesTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pendingQuoteCap" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "customerTotalDueNow" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "customerSignatureUrl" TEXT,
    "customerInitialsUrl" TEXT,
    "staffSignatureUrl" TEXT,
    "staffId" TEXT,
    "pdfUrl" TEXT,
    "pdfKey" TEXT,
    "timestampTokenKey" TEXT,
    "timestampTsaUrl" TEXT,
    "timestampSerial" TEXT,
    "timestampStatus" "TimestampStatus" NOT NULL DEFAULT 'PENDING',
    "timestampedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "finalisedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageTariff" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultPrice" DECIMAL(10,2) NOT NULL,
    "categoryScope" TEXT[],
    "severityHint" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageTariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageCharge" (
    "id" TEXT NOT NULL,
    "returnAssessmentId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "damageTariffId" TEXT,
    "description" TEXT NOT NULL,
    "markerRef" TEXT,
    "severity" TEXT NOT NULL,
    "resolution" "ChargeResolution" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "quoteCapAmount" DECIMAL(10,2),
    "status" "ChargeStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "workOrderId" TEXT,
    "photoUrls" TEXT[],
    "staffNote" TEXT,
    "createdById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "capturedPaymentId" TEXT,
    "bondDeductionCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreement_agreementNumber_key" ON "RentalAgreement"("agreementNumber");

-- CreateIndex
CREATE INDEX "RentalAgreement_bookingId_idx" ON "RentalAgreement"("bookingId");

-- CreateIndex
CREATE INDEX "RentalAgreement_status_idx" ON "RentalAgreement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnAssessment_bookingId_key" ON "ReturnAssessment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnAssessment_inspectionId_key" ON "ReturnAssessment"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnAssessment_assessmentNumber_key" ON "ReturnAssessment"("assessmentNumber");

-- CreateIndex
CREATE INDEX "ReturnAssessment_status_idx" ON "ReturnAssessment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DamageTariff_code_key" ON "DamageTariff"("code");

-- CreateIndex
CREATE INDEX "DamageTariff_isActive_idx" ON "DamageTariff"("isActive");

-- CreateIndex
CREATE INDEX "DamageCharge_returnAssessmentId_idx" ON "DamageCharge"("returnAssessmentId");

-- CreateIndex
CREATE INDEX "DamageCharge_status_idx" ON "DamageCharge"("status");

-- CreateIndex
CREATE INDEX "DamageCharge_workOrderId_idx" ON "DamageCharge"("workOrderId");

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnAssessment" ADD CONSTRAINT "ReturnAssessment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnAssessment" ADD CONSTRAINT "ReturnAssessment_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnAssessment" ADD CONSTRAINT "ReturnAssessment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_returnAssessmentId_fkey" FOREIGN KEY ("returnAssessmentId") REFERENCES "ReturnAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_damageTariffId_fkey" FOREIGN KEY ("damageTariffId") REFERENCES "DamageTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "MaintenanceWorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageCharge" ADD CONSTRAINT "DamageCharge_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

