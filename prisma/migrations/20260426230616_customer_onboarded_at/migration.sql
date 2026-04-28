-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "onboardedAt" TIMESTAMPTZ,
ADD COLUMN     "onboardingVersion" TEXT;

-- CreateIndex
CREATE INDEX "CustomerProfile_onboardedAt_idx" ON "CustomerProfile"("onboardedAt");
