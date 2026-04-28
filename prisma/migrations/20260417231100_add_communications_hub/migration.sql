-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BOOKING_CONFIRMATION', 'BOOKING_MODIFIED', 'BOOKING_EXTENDED', 'BOOKING_CANCELLED', 'BOOKING_REMINDER', 'BOOKING_CHECKED_OUT', 'BOOKING_DUE_TODAY', 'BOOKING_OVERDUE', 'BOOKING_OVERDUE_ESCALATION', 'BOOKING_COMPLETED', 'PAYMENT_RECEIVED', 'INVOICE_ISSUED', 'BOND_HELD', 'BOND_RELEASED', 'BOND_CAPTURED', 'LEASE_AGREEMENT_COPY', 'RETURN_PAPERWORK_COPY', 'INSPECTION_REPORT_COPY', 'PROFILE_UPDATED_SELF', 'PROFILE_UPDATED_STAFF', 'LICENCE_EXPIRING', 'INCIDENT_REPORTED', 'INFRINGEMENT_NOMINATED', 'WORK_ORDER_ASSIGNED', 'VEHICLE_EXPIRY', 'REGO_EXPIRING', 'LOW_FLEET_AVAILABILITY', 'DAILY_OPS_SUMMARY', 'WEEKLY_REVENUE_SUMMARY', 'NEW_CUSTOMER_REGISTERED', 'MARKETING_PROMOTIONAL', 'MARKETING_NEWSLETTER', 'MARKETING_WINBACK', 'MARKETING_BIRTHDAY', 'MARKETING_ANNIVERSARY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('TRANSACTIONAL', 'ACCOUNT', 'OPERATIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'OPT_OUT', 'UNSUBSCRIBED');

-- AlterTable: CustomerProfile marketing consent
ALTER TABLE "CustomerProfile"
    ADD COLUMN "marketingSmsOptIn"            BOOLEAN   NOT NULL DEFAULT false,
    ADD COLUMN "marketingEmailUnsubscribedAt" TIMESTAMP(3),
    ADD COLUMN "marketingSmsUnsubscribedAt"   TIMESTAMP(3),
    ADD COLUMN "unsubscribeReason"            TEXT;

-- AlterTable: Notification.type text -> enum (coerce existing values safely)
ALTER TABLE "Notification" ADD COLUMN "type_new" "NotificationType";
UPDATE "Notification" SET "type_new" = CASE
    WHEN "type" = 'VEHICLE_EXPIRY'          THEN 'VEHICLE_EXPIRY'::"NotificationType"
    WHEN "type" = 'BOOKING_CONFIRMATION'    THEN 'BOOKING_CONFIRMATION'::"NotificationType"
    WHEN "type" = 'BOOKING_REMINDER'        THEN 'BOOKING_REMINDER'::"NotificationType"
    WHEN "type" = 'BOOKING_OVERDUE'         THEN 'BOOKING_OVERDUE'::"NotificationType"
    WHEN "type" = 'PAYMENT_RECEIVED'        THEN 'PAYMENT_RECEIVED'::"NotificationType"
    WHEN "type" = 'BOND_RELEASED'           THEN 'BOND_RELEASED'::"NotificationType"
    WHEN "type" = 'INVOICE_ISSUED'          THEN 'INVOICE_ISSUED'::"NotificationType"
    WHEN "type" = 'DAILY_OPS_SUMMARY'       THEN 'DAILY_OPS_SUMMARY'::"NotificationType"
    WHEN "type" = 'WEEKLY_REVENUE_SUMMARY'  THEN 'WEEKLY_REVENUE_SUMMARY'::"NotificationType"
    WHEN "type" = 'WORK_ORDER_ASSIGNED'     THEN 'WORK_ORDER_ASSIGNED'::"NotificationType"
    WHEN "type" = 'NEW_CUSTOMER_REGISTERED' THEN 'NEW_CUSTOMER_REGISTERED'::"NotificationType"
    ELSE 'CUSTOM'::"NotificationType"
END;
ALTER TABLE "Notification" DROP COLUMN "type";
ALTER TABLE "Notification" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "Notification" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "Notification" ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'TRANSACTIONAL';

-- AlterTable: CommunicationLog expansion
ALTER TABLE "CommunicationLog"
    ADD COLUMN "attachmentRefs"    JSONB,
    ADD COLUMN "campaignId"        TEXT,
    ADD COLUMN "category"          "NotificationCategory" NOT NULL DEFAULT 'TRANSACTIONAL',
    ADD COLUMN "deliveredAt"       TIMESTAMP(3),
    ADD COLUMN "errorMessage"      TEXT,
    ADD COLUMN "openedAt"          TIMESTAMP(3),
    ADD COLUMN "providerMessageId" TEXT,
    ADD COLUMN "providerStatus"    TEXT,
    ADD COLUMN "status"            "CampaignRecipientStatus" NOT NULL DEFAULT 'SENT',
    ADD COLUMN "type"              "NotificationType" NOT NULL DEFAULT 'CUSTOM';

-- AlterTable: NotificationTemplate expansion
ALTER TABLE "NotificationTemplate"
    ADD COLUMN "archivedAt"         TIMESTAMP(3),
    ADD COLUMN "category"           "NotificationCategory" NOT NULL DEFAULT 'TRANSACTIONAL',
    ADD COLUMN "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "createdById"        TEXT,
    ADD COLUMN "defaultAttachments" JSONB,
    ADD COLUMN "description"        TEXT,
    ADD COLUMN "type"               "NotificationType",
    ADD COLUMN "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedById"        TEXT;

-- CreateTable
CREATE TABLE "NotificationTemplateVersion" (
    "id"           TEXT NOT NULL,
    "templateId"   TEXT NOT NULL,
    "subject"      TEXT,
    "bodyTemplate" TEXT NOT NULL,
    "channels"     "NotificationChannel"[],
    "variables"    TEXT[],
    "updatedById"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAutomation" (
    "id"          TEXT NOT NULL,
    "type"        "NotificationType" NOT NULL,
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "channels"    "NotificationChannel"[],
    "leadTime"    JSONB,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "filters"     JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "archivedAt"  TIMESTAMP(3),

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id"                 TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "templateId"         TEXT,
    "segmentId"          TEXT,
    "manualRecipientIds" TEXT[],
    "channels"           "NotificationChannel"[],
    "subject"            TEXT,
    "bodyOverride"       TEXT,
    "attachmentRefs"     JSONB,
    "scheduledFor"       TIMESTAMP(3),
    "sentAt"             TIMESTAMP(3),
    "status"             "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "stats"              JSONB NOT NULL DEFAULT '{}',
    "createdById"        TEXT,
    "approvedById"       TEXT,
    "notes"              TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id"                 TEXT NOT NULL,
    "campaignId"         TEXT NOT NULL,
    "customerId"         TEXT NOT NULL,
    "status"             "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "channel"            "NotificationChannel" NOT NULL,
    "communicationLogId" TEXT,
    "errorMessage"       TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationTemplateVersion_templateId_createdAt_idx" ON "NotificationTemplateVersion"("templateId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAutomation_type_key" ON "NotificationAutomation"("type");

-- CreateIndex
CREATE INDEX "Segment_archivedAt_idx" ON "Segment"("archivedAt");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledFor_idx" ON "Campaign"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Campaign_createdAt_idx" ON "Campaign"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_customerId_idx" ON "CampaignRecipient"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_customerId_channel_key" ON "CampaignRecipient"("campaignId", "customerId", "channel");

-- CreateIndex
CREATE INDEX "CommunicationLog_customerId_sentAt_idx" ON "CommunicationLog"("customerId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "CommunicationLog_campaignId_status_idx" ON "CommunicationLog"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CommunicationLog_type_sentAt_idx" ON "CommunicationLog"("type", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "CommunicationLog_channel_sentAt_idx" ON "CommunicationLog"("channel", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_type_createdAt_idx" ON "Notification"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_type_key" ON "NotificationTemplate"("type");

-- AddForeignKey
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplateVersion" ADD CONSTRAINT "NotificationTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
