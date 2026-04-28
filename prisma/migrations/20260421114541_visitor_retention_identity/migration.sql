-- CreateEnum
CREATE TYPE "TrafficChannel" AS ENUM ('DIRECT', 'ORGANIC', 'PAID', 'SOCIAL', 'EMAIL', 'REFERRAL', 'OTHER');

-- AlterTable
ALTER TABLE "VisitorSession" ADD COLUMN     "isReturning" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sessionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "trafficChannel" "TrafficChannel",
ADD COLUMN     "visitorFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "VisitorSession_visitorFingerprint_startedAt_idx" ON "VisitorSession"("visitorFingerprint", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_trafficChannel_startedAt_idx" ON "VisitorSession"("trafficChannel", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_isReturning_startedAt_idx" ON "VisitorSession"("isReturning", "startedAt");

-- Backfill trafficChannel for existing sessions. Mirror classifyChannel()
-- in src/lib/analytics/channel.ts so the historical data classifies the
-- same way as new sessions. Order matters — PAID/EMAIL/SOCIAL override,
-- then DIRECT before ORGANIC/REFERRAL to keep the tree consistent.
UPDATE "VisitorSession"
SET "trafficChannel" = CASE
  WHEN "utmMedium" ILIKE '%cpc%' OR "utmMedium" ILIKE '%paid%' OR "utmMedium" ILIKE '%ppc%' THEN 'PAID'::"TrafficChannel"
  WHEN "utmMedium" ILIKE '%email%' OR "utmSource" = 'newsletter' THEN 'EMAIL'::"TrafficChannel"
  WHEN "utmSource" ILIKE '%facebook%'
    OR "utmSource" ILIKE '%instagram%'
    OR "utmSource" ILIKE '%tiktok%'
    OR "utmSource" ILIKE '%linkedin%'
    OR "utmSource" ILIKE '%twitter%'
    OR "utmSource" ILIKE '%x.com%'
    OR "utmSource" ILIKE '%youtube%' THEN 'SOCIAL'::"TrafficChannel"
  WHEN "utmSource" IS NULL AND "referrer" IS NULL THEN 'DIRECT'::"TrafficChannel"
  WHEN "utmSource" IS NULL AND "referrer" ~* '(google|bing|duckduckgo|yahoo|ecosia|brave)' THEN 'ORGANIC'::"TrafficChannel"
  WHEN "utmSource" IS NULL AND "referrer" IS NOT NULL THEN 'REFERRAL'::"TrafficChannel"
  ELSE 'OTHER'::"TrafficChannel"
END
WHERE "trafficChannel" IS NULL;
