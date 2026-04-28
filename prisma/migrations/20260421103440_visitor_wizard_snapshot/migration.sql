-- AlterTable
ALTER TABLE "VisitorSession" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "discountCode" TEXT,
ADD COLUMN     "pickupDepotId" TEXT,
ADD COLUMN     "quotedTotalCents" INTEGER,
ADD COLUMN     "vehicleId" TEXT,
ADD COLUMN     "wizardState" JSONB;

-- CreateIndex
CREATE INDEX "VisitorSession_pickupDepotId_startedAt_idx" ON "VisitorSession"("pickupDepotId", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_categoryId_startedAt_idx" ON "VisitorSession"("categoryId", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_vehicleId_startedAt_idx" ON "VisitorSession"("vehicleId", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_discountCode_startedAt_idx" ON "VisitorSession"("discountCode", "startedAt");
