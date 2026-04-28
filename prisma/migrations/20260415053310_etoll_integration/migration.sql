-- CreateEnum
CREATE TYPE "EtollSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "EtollAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "loginUrl" TEXT NOT NULL DEFAULT 'https://account.myetoll.transport.nsw.gov.au/login',
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "passwordIv" TEXT NOT NULL,
    "passwordTag" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adminFeeCents" INTEGER NOT NULL DEFAULT 2500,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "EtollSyncStatus",
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtollAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EtollSync" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "EtollSyncStatus" NOT NULL DEFAULT 'RUNNING',
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

    CONSTRAINT "EtollSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtollSync_accountId_startedAt_idx" ON "EtollSync"("accountId", "startedAt");

-- AddForeignKey
ALTER TABLE "EtollSync" ADD CONSTRAINT "EtollSync_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EtollAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
