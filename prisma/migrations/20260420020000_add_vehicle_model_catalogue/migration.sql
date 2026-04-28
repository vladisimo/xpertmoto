-- CreateEnum
CREATE TYPE "SpecConfidence" AS ENUM ('OFFICIAL_MANUFACTURER', 'REPUTABLE_SECONDARY', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "VehicleModelDocumentType" AS ENUM ('OWNERS_MANUAL', 'SERVICE_SCHEDULE', 'PARTS_CATALOGUE', 'WIRING_DIAGRAM', 'BROCHURE');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "modelId" TEXT;

-- CreateTable
CREATE TABLE "VehicleModel" (
    "id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" TEXT,
    "engineCapacityCc" INTEGER,
    "enginePowerKw" DECIMAL(5,2),
    "engineTorqueNm" DECIMAL(5,2),
    "dryWeightKg" DECIMAL(6,2),
    "fuelTankLitres" DECIMAL(4,2),
    "fuelType" TEXT,
    "topSpeedKmh" INTEGER,
    "seatHeightMm" INTEGER,
    "tyreFront" TEXT,
    "tyreRear" TEXT,
    "serviceIntervalKm" INTEGER,
    "serviceIntervalMonths" INTEGER,
    "specsSourceUrl" TEXT,
    "specsSourceName" TEXT,
    "specsFetchedAt" TIMESTAMP(3),
    "specsConfidence" "SpecConfidence" NOT NULL DEFAULT 'UNVERIFIED',
    "lastEnrichmentError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleModelDocument" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "type" "VehicleModelDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "pageCount" INTEGER,
    "language" TEXT NOT NULL DEFAULT 'en-AU',
    "sha256" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleModelDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleModel_slug_key" ON "VehicleModel"("slug");

-- CreateIndex
CREATE INDEX "VehicleModel_categoryId_idx" ON "VehicleModel"("categoryId");

-- CreateIndex
CREATE INDEX "VehicleModel_specsConfidence_idx" ON "VehicleModel"("specsConfidence");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleModel_make_model_year_key" ON "VehicleModel"("make", "model", "year");

-- CreateIndex
CREATE INDEX "VehicleModelDocument_modelId_idx" ON "VehicleModelDocument"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleModelDocument_modelId_type_sha256_key" ON "VehicleModelDocument"("modelId", "type", "sha256");

-- CreateIndex
CREATE INDEX "Vehicle_modelId_idx" ON "Vehicle"("modelId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleModel" ADD CONSTRAINT "VehicleModel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleModelDocument" ADD CONSTRAINT "VehicleModelDocument_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
