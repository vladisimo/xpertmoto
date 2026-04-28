-- G3 — UnmatchedTransaction queue. Rows appear here when reconciliation
-- cannot match a DB Payment with a Stripe charge, or vice versa, or when
-- a bank statement row doesn't tie back to a Stripe payout. See
-- docs/payments/runbook-reconciliation-variance.md for resolution.

-- CreateEnum
CREATE TYPE "UnmatchedTransactionSource" AS ENUM (
  'STRIPE_CHARGE',
  'STRIPE_PAYOUT',
  'BANK_STATEMENT',
  'SYSTEM_LEDGER'
);

-- CreateTable
CREATE TABLE "UnmatchedTransaction" (
  "id" TEXT NOT NULL,
  "source" "UnmatchedTransactionSource" NOT NULL,
  "externalId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolvedNote" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UnmatchedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnmatchedTransaction_source_externalId_key" ON "UnmatchedTransaction"("source", "externalId");

-- CreateIndex
CREATE INDEX "UnmatchedTransaction_source_resolvedAt_idx" ON "UnmatchedTransaction"("source", "resolvedAt");

-- CreateIndex
CREATE INDEX "UnmatchedTransaction_occurredAt_idx" ON "UnmatchedTransaction"("occurredAt");
