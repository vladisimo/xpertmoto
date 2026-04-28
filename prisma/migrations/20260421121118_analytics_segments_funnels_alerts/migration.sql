-- CreateTable
CREATE TABLE "AnalyticsSegment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsFunnel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsFunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsAlert" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "notifyEmails" JSONB NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "lastValue" DOUBLE PRECISION,
    "lastCheckedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsSegment_createdBy_idx" ON "AnalyticsSegment"("createdBy");

-- CreateIndex
CREATE INDEX "AnalyticsSegment_isShared_createdAt_idx" ON "AnalyticsSegment"("isShared", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsFunnel_createdBy_idx" ON "AnalyticsFunnel"("createdBy");

-- CreateIndex
CREATE INDEX "AnalyticsFunnel_isShared_createdAt_idx" ON "AnalyticsFunnel"("isShared", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsAlert_isActive_idx" ON "AnalyticsAlert"("isActive");

-- CreateIndex
CREATE INDEX "AnalyticsAlert_createdBy_idx" ON "AnalyticsAlert"("createdBy");

-- AddForeignKey
ALTER TABLE "AnalyticsSegment" ADD CONSTRAINT "AnalyticsSegment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsFunnel" ADD CONSTRAINT "AnalyticsFunnel_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsAlert" ADD CONSTRAINT "AnalyticsAlert_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
