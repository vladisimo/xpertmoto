-- CreateEnum
CREATE TYPE "LinktSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "LinktRegion" AS ENUM ('NSW', 'VIC', 'QLD');

-- CreateTable
CREATE TABLE "LinktAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" "LinktRegion" NOT NULL DEFAULT 'NSW',
    "loginUrl" TEXT NOT NULL DEFAULT 'https://www.linkt.com.au/login',
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "passwordIv" TEXT NOT NULL,
    "passwordTag" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adminFeeCents" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "LinktSyncStatus",
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinktAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinktSync" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "LinktSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "rowsFetched" INTEGER NOT NULL DEFAULT 0,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsDuplicate" INTEGER NOT NULL DEFAULT 0,
    "rowsUnmatched" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "rawFileUrl" TEXT,
    "unmatched" JSONB,

    CONSTRAINT "LinktSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinktUnmatchedRow" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalHash" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "plate" TEXT NOT NULL,
    "tollpoint" TEXT NOT NULL,
    "rawDetails" TEXT,
    "amountCents" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAction" TEXT,
    "resolvedInfringementId" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinktUnmatchedRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinktSync_accountId_startedAt_idx" ON "LinktSync"("accountId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LinktUnmatchedRow_externalHash_key" ON "LinktUnmatchedRow"("externalHash");

-- CreateIndex
CREATE INDEX "LinktUnmatchedRow_accountId_resolvedAt_idx" ON "LinktUnmatchedRow"("accountId", "resolvedAt");

-- CreateIndex
CREATE INDEX "LinktUnmatchedRow_eventAt_idx" ON "LinktUnmatchedRow"("eventAt");

-- AddForeignKey
ALTER TABLE "LinktSync" ADD CONSTRAINT "LinktSync_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LinktAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinktUnmatchedRow" ADD CONSTRAINT "LinktUnmatchedRow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LinktAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
