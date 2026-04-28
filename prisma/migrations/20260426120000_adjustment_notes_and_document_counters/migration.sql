-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('EXTENSION', 'SWAP', 'DAMAGE', 'LATE_FEE', 'FUEL', 'CLEANING', 'ZONE_SURCHARGE', 'INFRINGEMENT', 'CANCELLATION', 'REFUND', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "AdjustmentNoteStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "TaxDocumentType" AS ENUM ('INVOICE', 'ADJUSTMENT_NOTE', 'RECEIPT');

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "abn" TEXT,
ADD COLUMN     "companyName" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "issuedAt" TIMESTAMPTZ,
ADD COLUMN     "pdfKey" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "receiptNumber" TEXT,
ADD COLUMN     "receiptPdfKey" TEXT,
ADD COLUMN     "receiptPdfUrl" TEXT;

-- CreateTable
CREATE TABLE "AdjustmentNote" (
    "id" TEXT NOT NULL,
    "adjustmentNumber" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "bookingId" TEXT,
    "customerId" TEXT,
    "type" "AdjustmentType" NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "description" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "gstAmount" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "status" "AdjustmentNoteStatus" NOT NULL DEFAULT 'ISSUED',
    "pdfUrl" TEXT,
    "pdfKey" TEXT,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "paymentId" TEXT,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMPTZ,
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdjustmentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "documentType" "TaxDocumentType" NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("documentType","financialYear")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdjustmentNote_adjustmentNumber_key" ON "AdjustmentNote"("adjustmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AdjustmentNote_paymentId_key" ON "AdjustmentNote"("paymentId");

-- CreateIndex
CREATE INDEX "AdjustmentNote_invoiceId_idx" ON "AdjustmentNote"("invoiceId");

-- CreateIndex
CREATE INDEX "AdjustmentNote_bookingId_idx" ON "AdjustmentNote"("bookingId");

-- CreateIndex
CREATE INDEX "AdjustmentNote_customerId_idx" ON "AdjustmentNote"("customerId");

-- CreateIndex
CREATE INDEX "AdjustmentNote_issuedAt_idx" ON "AdjustmentNote"("issuedAt");

-- CreateIndex
CREATE INDEX "AdjustmentNote_reason_idx" ON "AdjustmentNote"("reason");

-- CreateIndex
CREATE INDEX "AdjustmentNote_deletedAt_idx" ON "AdjustmentNote"("deletedAt");

-- CreateIndex
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- AddForeignKey
ALTER TABLE "AdjustmentNote" ADD CONSTRAINT "AdjustmentNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentNote" ADD CONSTRAINT "AdjustmentNote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentNote" ADD CONSTRAINT "AdjustmentNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentNote" ADD CONSTRAINT "AdjustmentNote_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentNote" ADD CONSTRAINT "AdjustmentNote_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

