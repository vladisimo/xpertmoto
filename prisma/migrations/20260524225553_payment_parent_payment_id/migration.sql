-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "parentPaymentId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_parentPaymentId_idx" ON "Payment"("parentPaymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_parentPaymentId_fkey" FOREIGN KEY ("parentPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
