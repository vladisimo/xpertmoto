-- AlterEnum: gift cards now start PENDING until their payment confirms.
ALTER TYPE "GiftCardStatus" ADD VALUE 'PENDING' BEFORE 'ACTIVE';

-- AlterTable: correlate the card with the PaymentIntent that pays for it so
-- the payment_intent.succeeded webhook can activate exactly this card.
ALTER TABLE "GiftCard" ADD COLUMN "stripePaymentIntentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_stripePaymentIntentId_key" ON "GiftCard"("stripePaymentIntentId");
