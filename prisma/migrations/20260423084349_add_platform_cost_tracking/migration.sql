-- CreateEnum
CREATE TYPE "StorageUsageAction" AS ENUM ('UPLOAD', 'DELETE');

-- CreateTable
CREATE TABLE "OcrCostLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "costAud" DECIMAL(10,6) NOT NULL,
    "customerId" TEXT,
    "bookingId" TEXT,
    "triggeredById" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrCostLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwilioMessageLog" (
    "id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "purpose" TEXT,
    "numSegments" INTEGER,
    "priceAud" DECIMAL(10,6),
    "priceCurrency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "customerId" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwilioMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSendLog" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "toEmail" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "errorMessage" TEXT,
    "customerId" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageUsageEvent" (
    "id" TEXT NOT NULL,
    "action" "StorageUsageAction" NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "customerId" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerRequestLog" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "bytesOut" INTEGER,
    "userId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sampleWeight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservabilityUsageSnapshot" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "provider" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "costAud" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservabilityUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrCostLog_createdAt_idx" ON "OcrCostLog"("createdAt");

-- CreateIndex
CREATE INDEX "OcrCostLog_kind_createdAt_idx" ON "OcrCostLog"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "OcrCostLog_provider_createdAt_idx" ON "OcrCostLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "OcrCostLog_customerId_idx" ON "OcrCostLog"("customerId");

-- CreateIndex
CREATE INDEX "OcrCostLog_bookingId_idx" ON "OcrCostLog"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "TwilioMessageLog_sid_key" ON "TwilioMessageLog"("sid");

-- CreateIndex
CREATE INDEX "TwilioMessageLog_createdAt_idx" ON "TwilioMessageLog"("createdAt");

-- CreateIndex
CREATE INDEX "TwilioMessageLog_customerId_idx" ON "TwilioMessageLog"("customerId");

-- CreateIndex
CREATE INDEX "TwilioMessageLog_bookingId_idx" ON "TwilioMessageLog"("bookingId");

-- CreateIndex
CREATE INDEX "TwilioMessageLog_status_createdAt_idx" ON "TwilioMessageLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailSendLog_createdAt_idx" ON "EmailSendLog"("createdAt");

-- CreateIndex
CREATE INDEX "EmailSendLog_customerId_idx" ON "EmailSendLog"("customerId");

-- CreateIndex
CREATE INDEX "EmailSendLog_bookingId_idx" ON "EmailSendLog"("bookingId");

-- CreateIndex
CREATE INDEX "EmailSendLog_provider_createdAt_idx" ON "EmailSendLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "EmailSendLog_providerMessageId_idx" ON "EmailSendLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "StorageUsageEvent_createdAt_idx" ON "StorageUsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "StorageUsageEvent_folder_createdAt_idx" ON "StorageUsageEvent"("folder", "createdAt");

-- CreateIndex
CREATE INDEX "StorageUsageEvent_action_createdAt_idx" ON "StorageUsageEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "StorageUsageEvent_customerId_idx" ON "StorageUsageEvent"("customerId");

-- CreateIndex
CREATE INDEX "StorageUsageEvent_bookingId_idx" ON "StorageUsageEvent"("bookingId");

-- CreateIndex
CREATE INDEX "ServerRequestLog_createdAt_idx" ON "ServerRequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "ServerRequestLog_path_createdAt_idx" ON "ServerRequestLog"("path", "createdAt");

-- CreateIndex
CREATE INDEX "ServerRequestLog_status_createdAt_idx" ON "ServerRequestLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ObservabilityUsageSnapshot_date_idx" ON "ObservabilityUsageSnapshot"("date");

-- CreateIndex
CREATE INDEX "ObservabilityUsageSnapshot_provider_date_idx" ON "ObservabilityUsageSnapshot"("provider", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ObservabilityUsageSnapshot_provider_metric_date_key" ON "ObservabilityUsageSnapshot"("provider", "metric", "date");
