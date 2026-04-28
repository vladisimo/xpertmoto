-- G9 — Append-only PaymentEvent log. Every Payment row insert / status
-- mutation must also write a PaymentEvent row so we can replay the state
-- machine and audit forensically.

-- CreateEnum
CREATE TYPE "PaymentEventType" AS ENUM (
  'CREATED',
  'STATUS_CHANGED',
  'CAPTURED',
  'REFUNDED',
  'DISPUTED',
  'VOIDED',
  'RETRY_ATTEMPTED',
  'RETRY_EXHAUSTED'
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "eventType" "PaymentEventType" NOT NULL,
  "previousStatus" "PaymentStatus",
  "newStatus" "PaymentStatus",
  "amountDelta" DECIMAL(10,2),
  "source" TEXT NOT NULL,
  "stripeEventId" TEXT,
  "actorUserId" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PaymentEvent"
  ADD CONSTRAINT "PaymentEvent_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent"
  ADD CONSTRAINT "PaymentEvent_stripeEventId_fkey"
  FOREIGN KEY ("stripeEventId") REFERENCES "StripeWebhookEvent"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_stripeEventId_idx" ON "PaymentEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_eventType_createdAt_idx" ON "PaymentEvent"("eventType", "createdAt");
