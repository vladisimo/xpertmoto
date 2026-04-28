-- CreateTable
CREATE TABLE "PricingTier" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "vehicleId" TEXT,
    "minDays" INTEGER NOT NULL,
    "maxDays" INTEGER NOT NULL,
    "tierTotal" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingTier_categoryId_minDays_idx" ON "PricingTier"("categoryId", "minDays");

-- CreateIndex
CREATE INDEX "PricingTier_vehicleId_minDays_idx" ON "PricingTier"("vehicleId", "minDays");

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
