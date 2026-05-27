-- AlterTable
ALTER TABLE "StripeFeeLedger" ADD COLUMN     "stripePaymentIntentId" TEXT;

-- CreateIndex
CREATE INDEX "StripeFeeLedger_stripePaymentIntentId_idx" ON "StripeFeeLedger"("stripePaymentIntentId");
