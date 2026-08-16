-- AlterTable
ALTER TABLE "BookingInsurance" ADD COLUMN     "excessAmountSnapshot" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "excessVoidReason" TEXT,
ADD COLUMN     "excessVoided" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "excessVoidedAt" TIMESTAMPTZ,
ADD COLUMN     "excessVoidedById" TEXT;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_excessVoidedById_fkey" FOREIGN KEY ("excessVoidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: freeze the current option excess onto every existing attach so
-- historical hires get the excess they actually agreed to (best available
-- approximation — the live option value at migration time).
UPDATE "BookingInsurance" bi
SET "excessAmountSnapshot" = io."excessAmount"
FROM "InsuranceOption" io
WHERE bi."insuranceOptionId" = io.id
  AND bi."excessAmountSnapshot" IS NULL;
