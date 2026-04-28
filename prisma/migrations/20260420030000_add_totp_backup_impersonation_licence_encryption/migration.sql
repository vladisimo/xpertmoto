-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('SCHEDULED', 'MANUAL_ADMIN');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "impersonatorId" TEXT;

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "licenceNumberEnc" JSONB,
ADD COLUMN     "passportNumberEnc" JSONB;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "impersonatorId" TEXT;

-- CreateTable
CREATE TABLE "DatabaseBackup" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "sizeBytes" BIGINT,
    "storageUrl" TEXT,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "errorMessage" TEXT,
    "triggeredBy" "BackupTrigger" NOT NULL,
    "triggeredById" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "schemaVersion" TEXT,

    CONSTRAINT "DatabaseBackup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTotp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedSecret" JSONB NOT NULL,
    "recoveryCodes" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTotp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatabaseBackup_startedAt_idx" ON "DatabaseBackup"("startedAt");

-- CreateIndex
CREATE INDEX "DatabaseBackup_status_idx" ON "DatabaseBackup"("status");

-- CreateIndex
CREATE INDEX "DatabaseBackup_retentionUntil_idx" ON "DatabaseBackup"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "UserTotp_userId_key" ON "UserTotp"("userId");

-- CreateIndex
CREATE INDEX "UserTotp_userId_idx" ON "UserTotp"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_impersonatorId_idx" ON "AuditLog"("impersonatorId");

-- CreateIndex
CREATE INDEX "Session_impersonatorId_idx" ON "Session"("impersonatorId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_impersonatorId_fkey" FOREIGN KEY ("impersonatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTotp" ADD CONSTRAINT "UserTotp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

