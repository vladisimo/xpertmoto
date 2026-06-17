-- CreateEnum
CREATE TYPE "NominationHandling" AS ENUM ('NOMINATE_DRIVER', 'PAY_AND_RECOVER');

-- CreateEnum
CREATE TYPE "NominationSubmissionStatus" AS ENUM ('DRAFTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "NominationChannel" AS ENUM ('ENOMINATIONS_CSV', 'STAT_DEC_MAIL', 'MYPENALTY_WEB');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InfringementStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "InfringementStatus" ADD VALUE 'NOMINATION_SUBMITTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InfringementType" ADD VALUE 'MOBILE_PHONE';
ALTER TYPE "InfringementType" ADD VALUE 'SEATBELT';
ALTER TYPE "InfringementType" ADD VALUE 'UNREGISTERED';

-- AlterTable
ALTER TABLE "Infringement" ADD COLUMN     "deadlineEscalatedAt" TIMESTAMPTZ,
ADD COLUMN     "demeritPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "handling" "NominationHandling",
ADD COLUMN     "issueDate" DATE,
ADD COLUMN     "nominationDeadline" DATE,
ADD COLUMN     "offenceCode" TEXT,
ADD COLUMN     "offenceDescription" TEXT,
ADD COLUMN     "offenceLocation" TEXT;

-- CreateTable
CREATE TABLE "NominationSubmission" (
    "id" TEXT NOT NULL,
    "infringementId" TEXT NOT NULL,
    "channel" "NominationChannel" NOT NULL,
    "status" "NominationSubmissionStatus" NOT NULL DEFAULT 'DRAFTED',
    "driverFullName" TEXT NOT NULL,
    "driverDob" DATE,
    "driverAddress" TEXT,
    "driverLicenceState" TEXT,
    "driverLicenceNumberEnc" JSONB,
    "csvFileKey" TEXT,
    "statDecPdfKey" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMPTZ,
    "receiptReference" TEXT,
    "receiptFileKey" TEXT,
    "rejectionReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NominationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NominationSubmission_infringementId_idx" ON "NominationSubmission"("infringementId");

-- CreateIndex
CREATE INDEX "NominationSubmission_status_idx" ON "NominationSubmission"("status");

-- CreateIndex
CREATE INDEX "NominationSubmission_createdAt_idx" ON "NominationSubmission"("createdAt");

-- CreateIndex
CREATE INDEX "NominationSubmission_deletedAt_idx" ON "NominationSubmission"("deletedAt");

-- CreateIndex
CREATE INDEX "Infringement_nominationDeadline_idx" ON "Infringement"("nominationDeadline");

-- CreateIndex
CREATE INDEX "Infringement_handling_idx" ON "Infringement"("handling");

-- AddForeignKey
ALTER TABLE "NominationSubmission" ADD CONSTRAINT "NominationSubmission_infringementId_fkey" FOREIGN KEY ("infringementId") REFERENCES "Infringement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
