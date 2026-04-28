-- CreateEnum
CREATE TYPE "VisitorEventKind" AS ENUM ('CLICK', 'CTA_CLICK', 'FLEET_VIEW', 'FLEET_CLICK', 'FORM_FIELD_FOCUS', 'FORM_FIELD_CHANGE', 'FORM_FIELD_BLUR', 'SEARCH', 'DISCOUNT_ATTEMPTED', 'DISCOUNT_APPLIED', 'DISCOUNT_REJECTED', 'SCROLL_DEPTH', 'EXIT_INTENT', 'RAGE_CLICK', 'DEAD_CLICK', 'COPY', 'CHAT_OPEN', 'CHAT_MESSAGE_SENT', 'WIZARD_STEP_ENTER', 'WIZARD_STEP_LEAVE', 'WIZARD_SNAPSHOT', 'PRICE_VIEWED', 'CUSTOM');

-- CreateTable
CREATE TABLE "VisitorEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "VisitorEventKind" NOT NULL,
    "path" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target" TEXT,
    "value" TEXT,
    "numericValue" INTEGER,
    "metadata" JSONB,
    "wizardStep" INTEGER,
    "deviceType" "VisitorDeviceType",

    CONSTRAINT "VisitorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitorEvent_sessionId_occurredAt_idx" ON "VisitorEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "VisitorEvent_kind_occurredAt_idx" ON "VisitorEvent"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "VisitorEvent_path_kind_occurredAt_idx" ON "VisitorEvent"("path", "kind", "occurredAt");

-- AddForeignKey
ALTER TABLE "VisitorEvent" ADD CONSTRAINT "VisitorEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
