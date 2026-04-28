-- G3 — Stripe fee ledger. Populated by the stripe-reconcile job from
-- /v1/balance_transactions. Feeds net-revenue reporting + month-end close.

-- CreateTable
CREATE TABLE "StripeFeeLedger" (
  "id" TEXT NOT NULL,
  "stripeChargeId" TEXT NOT NULL,
  "stripePayoutId" TEXT,
  "feeType" TEXT NOT NULL,
  "feeAmountCents" INTEGER NOT NULL,
  "netAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'aud',
  "balanceTxnCreatedAt" TIMESTAMP(3) NOT NULL,
  "payoutArrivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StripeFeeLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeFeeLedger_stripeChargeId_key" ON "StripeFeeLedger"("stripeChargeId");

-- CreateIndex
CREATE INDEX "StripeFeeLedger_stripePayoutId_idx" ON "StripeFeeLedger"("stripePayoutId");

-- CreateIndex
CREATE INDEX "StripeFeeLedger_balanceTxnCreatedAt_idx" ON "StripeFeeLedger"("balanceTxnCreatedAt");
