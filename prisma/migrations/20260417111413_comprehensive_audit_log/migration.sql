-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('AUTH', 'PAGE_VIEW', 'MUTATION', 'QUERY', 'JOB', 'API', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "category" "AuditCategory" NOT NULL DEFAULT 'MUTATION',
ADD COLUMN     "depotId" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "path" TEXT,
ADD COLUMN     "reqId" TEXT,
ADD COLUMN     "status" "AuditStatus" NOT NULL DEFAULT 'SUCCESS';

-- CreateIndex
CREATE INDEX "AuditLog_category_timestamp_idx" ON "AuditLog"("category", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_status_timestamp_idx" ON "AuditLog"("status", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_depotId_timestamp_idx" ON "AuditLog"("depotId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_reqId_idx" ON "AuditLog"("reqId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "Depot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
