-- G6 — Stripe Customer + stored payment method fields on CustomerProfile.
-- Enables off-session capture for delayed recoveries (tolls, fines,
-- damage excess). Only opaque Stripe tokens stored; PAN / CVV never
-- touch our servers.

-- AlterTable
ALTER TABLE "CustomerProfile"
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "defaultStripePaymentMethodId" TEXT,
  ADD COLUMN "stripePaymentMethodBrand" TEXT,
  ADD COLUMN "stripePaymentMethodLast4" TEXT,
  ADD COLUMN "stripePaymentMethodExpMonth" INTEGER,
  ADD COLUMN "stripePaymentMethodExpYear" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_stripeCustomerId_key" ON "CustomerProfile"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "CustomerProfile_stripeCustomerId_idx" ON "CustomerProfile"("stripeCustomerId");
