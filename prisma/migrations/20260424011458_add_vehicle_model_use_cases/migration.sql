-- CreateEnum
CREATE TYPE "FleetUseCase" AS ENUM ('ADVENTURE', 'COMMUTING', 'PRACTICE', 'DELIVERY', 'SPORT_CRUISER', 'LEARNER_APPROVED');

-- AlterTable
ALTER TABLE "VehicleModel" ADD COLUMN     "heroImageKey" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "useCases" "FleetUseCase"[] DEFAULT ARRAY[]::"FleetUseCase"[];
