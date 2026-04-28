-- CreateEnum
CREATE TYPE "VisitorOutcome" AS ENUM ('BOUNCED', 'ABANDONED_WIZARD', 'CONVERTED', 'LEFT');

-- CreateEnum
CREATE TYPE "VisitorDeviceType" AS ENUM ('MOBILE', 'TABLET', 'DESKTOP', 'BOT');

-- CreateEnum
CREATE TYPE "InteractionOutcome" AS ENUM ('CONVERTED', 'NO_RESPONSE', 'ABANDONED', 'IN_PROGRESS', 'RESOLVED');

-- AlterTable
ALTER TABLE "SupportConversation"
    ADD COLUMN "attributedBookingId" TEXT,
    ADD COLUMN "firstResponseSeconds" INTEGER,
    ADD COLUMN "firstStaffResponseAt" TIMESTAMP(3),
    ADD COLUMN "interactionOutcome" "InteractionOutcome";

-- AlterTable
ALTER TABLE "VisitorSession"
    ADD COLUMN "city" TEXT,
    ADD COLUMN "convertedBookingId" TEXT,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "deviceType" "VisitorDeviceType",
    ADD COLUMN "durationSeconds" INTEGER,
    ADD COLUMN "endedAt" TIMESTAMP(3),
    ADD COLUMN "ipHash" TEXT,
    ADD COLUMN "landingPath" TEXT,
    ADD COLUMN "outcome" "VisitorOutcome",
    ADD COLUMN "referrer" TEXT,
    ADD COLUMN "region" TEXT,
    ADD COLUMN "totalPageViews" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "utmCampaign" TEXT,
    ADD COLUMN "utmMedium" TEXT,
    ADD COLUMN "utmSource" TEXT,
    ADD COLUMN "wizardHighestStep" INTEGER;

-- CreateTable
CREATE TABLE "VisitorPageView" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "referrer" TEXT,

    CONSTRAINT "VisitorPageView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitorPageView_sessionId_enteredAt_idx" ON "VisitorPageView"("sessionId", "enteredAt");

-- CreateIndex
CREATE INDEX "VisitorPageView_path_enteredAt_idx" ON "VisitorPageView"("path", "enteredAt");

-- CreateIndex
CREATE INDEX "SupportConversation_firstStaffResponseAt_idx" ON "SupportConversation"("firstStaffResponseAt");

-- CreateIndex
CREATE INDEX "SupportConversation_attributedBookingId_idx" ON "SupportConversation"("attributedBookingId");

-- CreateIndex
CREATE INDEX "VisitorSession_country_startedAt_idx" ON "VisitorSession"("country", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_outcome_startedAt_idx" ON "VisitorSession"("outcome", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_convertedBookingId_idx" ON "VisitorSession"("convertedBookingId");

-- CreateIndex
CREATE INDEX "VisitorSession_utmSource_startedAt_idx" ON "VisitorSession"("utmSource", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_ipHash_startedAt_idx" ON "VisitorSession"("ipHash", "startedAt");

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_attributedBookingId_fkey" FOREIGN KEY ("attributedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_convertedBookingId_fkey" FOREIGN KEY ("convertedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorPageView" ADD CONSTRAINT "VisitorPageView_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
