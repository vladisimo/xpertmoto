-- Booking_no_overlap uses tsrange(timestamp, timestamp). Dropped here
-- before converting pickupDateTime/returnDateTime to timestamptz, then
-- recreated at the bottom of this migration with tstzrange(timestamptz,
-- timestamptz) which is still IMMUTABLE.
ALTER TABLE "Booking" DROP CONSTRAINT IF EXISTS "Booking_no_overlap";

-- DropForeignKey
ALTER TABLE "RentalAgreement" DROP CONSTRAINT "RentalAgreement_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "ReturnAssessment" DROP CONSTRAINT "ReturnAssessment_bookingId_fkey";

-- DropIndex
DROP INDEX "Depot_slug_key";

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "Addon" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "lastUsedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "BondLedger" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "pickupDateTime" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "returnDateTime" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "actualPickupDateTime" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "actualReturnDateTime" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "BookingAddon" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "BookingStatusLog" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "timestamp" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "licenceExpiry" SET DATA TYPE DATE,
ALTER COLUMN "licenceVerifiedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "marketingEmailUnsubscribedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "marketingSmsUnsubscribedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "lastBookingAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "DailyRevenue" ALTER COLUMN "date" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "DemandEvent" ALTER COLUMN "startDate" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "endDate" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "DepotOperatingHours" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "holidayDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Discount" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "validFrom" SET DATA TYPE DATE,
ALTER COLUMN "validTo" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "customerNotifiedAt" TIMESTAMPTZ,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "dateTime" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "resolvedAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "Infringement" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "offenceDate" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "nominatedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "customerNotifiedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "dueDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "Inspection" ALTER COLUMN "dateTime" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "customerAckedAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "InspectionItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "InsuranceOption" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "dueDate" SET DATA TYPE DATE,
ALTER COLUMN "sentAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "MaintenancePart" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "MaintenanceSchedule" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "lastCompletedDate" SET DATA TYPE DATE,
ALTER COLUMN "nextDueDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "MaintenanceWorkOrder" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "scheduledStartAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "scheduledEndAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "processedAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "PriceRecommendation" ALTER COLUMN "date" SET DATA TYPE DATE,
ALTER COLUMN "computedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "overriddenAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "startDate" SET DATA TYPE DATE,
ALTER COLUMN "endDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "currentPeriodStart" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "currentPeriodEnd" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "pausedAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "cancelledAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "emailVerified" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "phoneVerified" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "dateOfBirth" SET DATA TYPE DATE,
ALTER COLUMN "lastLoginAt" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "Vehicle" ALTER COLUMN "regoExpiry" SET DATA TYPE DATE,
ALTER COLUMN "purchaseDate" SET DATA TYPE DATE,
ALTER COLUMN "insuranceExpiry" SET DATA TYPE DATE,
ALTER COLUMN "ctpExpiry" SET DATA TYPE DATE,
ALTER COLUMN "lastServiceDate" SET DATA TYPE DATE,
ALTER COLUMN "nextServiceDueDate" SET DATA TYPE DATE,
ALTER COLUMN "warrantyExpiry" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "VehicleDocument" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "expiryDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "VehicleStatusLog" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "timestamp" SET DATA TYPE TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "VehicleTransfer" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "scheduledAt" SET DATA TYPE TIMESTAMPTZ,
ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "ApiKey_isActive_idx" ON "ApiKey"("isActive");

-- CreateIndex
CREATE INDEX "ApiKey_createdById_idx" ON "ApiKey"("createdById");

-- CreateIndex
CREATE INDEX "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");

-- CreateIndex
CREATE INDEX "BondLedger_deletedAt_idx" ON "BondLedger"("deletedAt");

-- CreateIndex
CREATE INDEX "Booking_categoryId_idx" ON "Booking"("categoryId");

-- CreateIndex
CREATE INDEX "Booking_source_idx" ON "Booking"("source");

-- CreateIndex
CREATE INDEX "Booking_extensionOfId_idx" ON "Booking"("extensionOfId");

-- CreateIndex
CREATE INDEX "Booking_deletedAt_idx" ON "Booking"("deletedAt");

-- CreateIndex
CREATE INDEX "BookingStatusLog_timestamp_idx" ON "BookingStatusLog"("timestamp");

-- CreateIndex
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");

-- CreateIndex
CREATE INDEX "Campaign_approvedById_idx" ON "Campaign"("approvedById");

-- CreateIndex
CREATE INDEX "CommunicationLog_bookingId_idx" ON "CommunicationLog"("bookingId");

-- CreateIndex
CREATE INDEX "CommunicationLog_sentById_idx" ON "CommunicationLog"("sentById");

-- CreateIndex
CREATE INDEX "CreditNote_deletedAt_idx" ON "CreditNote"("deletedAt");

-- CreateIndex
CREATE INDEX "DamageCharge_inspectionId_idx" ON "DamageCharge"("inspectionId");

-- CreateIndex
CREATE INDEX "DamageCharge_createdById_idx" ON "DamageCharge"("createdById");

-- CreateIndex
CREATE INDEX "DamageCharge_resolvedById_idx" ON "DamageCharge"("resolvedById");

-- CreateIndex
CREATE INDEX "DemandEvent_isActive_idx" ON "DemandEvent"("isActive");

-- CreateIndex
CREATE INDEX "Depot_deletedAt_idx" ON "Depot"("deletedAt");

-- CreateIndex
CREATE INDEX "Depot_slug_idx" ON "Depot"("slug");

-- CreateIndex
CREATE INDEX "DepotOperatingHours_holidayDate_idx" ON "DepotOperatingHours"("holidayDate");

-- CreateIndex
CREATE INDEX "GiftCard_expiresAt_idx" ON "GiftCard"("expiresAt");

-- CreateIndex
CREATE INDEX "Incident_reportedById_idx" ON "Incident"("reportedById");

-- CreateIndex
CREATE INDEX "Incident_assignedToId_idx" ON "Incident"("assignedToId");

-- CreateIndex
CREATE INDEX "Incident_customerId_idx" ON "Incident"("customerId");

-- CreateIndex
CREATE INDEX "Incident_deletedAt_idx" ON "Incident"("deletedAt");

-- CreateIndex
CREATE INDEX "Infringement_vehicleId_idx" ON "Infringement"("vehicleId");

-- CreateIndex
CREATE INDEX "Infringement_customerId_idx" ON "Infringement"("customerId");

-- CreateIndex
CREATE INDEX "Infringement_bookingId_idx" ON "Infringement"("bookingId");

-- CreateIndex
CREATE INDEX "Infringement_deletedAt_idx" ON "Infringement"("deletedAt");

-- CreateIndex
CREATE INDEX "Inspection_type_idx" ON "Inspection"("type");

-- CreateIndex
CREATE INDEX "Inspection_status_idx" ON "Inspection"("status");

-- CreateIndex
CREATE INDEX "Inspection_inspectorId_idx" ON "Inspection"("inspectorId");

-- CreateIndex
CREATE INDEX "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_isActive_nextDueDate_idx" ON "MaintenanceSchedule"("isActive", "nextDueDate");

-- CreateIndex
CREATE INDEX "MaintenanceWorkOrder_priority_idx" ON "MaintenanceWorkOrder"("priority");

-- CreateIndex
CREATE INDEX "MaintenanceWorkOrder_assignedToId_idx" ON "MaintenanceWorkOrder"("assignedToId");

-- CreateIndex
CREATE INDEX "MaintenanceWorkOrder_deletedAt_idx" ON "MaintenanceWorkOrder"("deletedAt");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "NotificationTemplateVersion_updatedById_idx" ON "NotificationTemplateVersion"("updatedById");

-- CreateIndex
CREATE INDEX "Payment_type_idx" ON "Payment"("type");

-- CreateIndex
CREATE INDEX "Payment_deletedAt_idx" ON "Payment"("deletedAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_actorUserId_idx" ON "PaymentEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "Referral_qualifyingBookingId_idx" ON "Referral"("qualifyingBookingId");

-- CreateIndex
CREATE INDEX "RentalAgreement_staffId_idx" ON "RentalAgreement"("staffId");

-- CreateIndex
CREATE INDEX "ReturnAssessment_staffId_idx" ON "ReturnAssessment"("staffId");

-- CreateIndex
CREATE INDEX "Review_vehicleCategoryId_idx" ON "Review"("vehicleCategoryId");

-- CreateIndex
CREATE INDEX "Season_isActive_startDate_endDate_idx" ON "Season"("isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Season_depotId_idx" ON "Season"("depotId");

-- CreateIndex
CREATE INDEX "Segment_createdById_idx" ON "Segment"("createdById");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE INDEX "SupportConversation_bookingId_idx" ON "SupportConversation"("bookingId");

-- CreateIndex
CREATE INDEX "SupportTicket_depotId_idx" ON "SupportTicket"("depotId");

-- CreateIndex
CREATE INDEX "SupportTicket_linkedBookingId_idx" ON "SupportTicket"("linkedBookingId");

-- CreateIndex
CREATE INDEX "SupportTicket_linkedIncidentId_idx" ON "SupportTicket"("linkedIncidentId");

-- CreateIndex
CREATE INDEX "UnmatchedTransaction_resolvedById_idx" ON "UnmatchedTransaction"("resolvedById");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "User_role_deletedAt_idx" ON "User"("role", "deletedAt");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Vehicle_deletedAt_idx" ON "Vehicle"("deletedAt");

-- CreateIndex
CREATE INDEX "Vehicle_status_deletedAt_idx" ON "Vehicle"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "Vehicle_depotId_deletedAt_idx" ON "Vehicle"("depotId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_rego_regoState_key" ON "Vehicle"("rego", "regoState");

-- CreateIndex
CREATE INDEX "VehicleDocument_expiryDate_idx" ON "VehicleDocument"("expiryDate");

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnAssessment" ADD CONSTRAINT "ReturnAssessment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial unique indexes: allow a soft-deleted User to be replaced by a
-- re-registration with the same email (APP compliance). The Prisma schema
-- no longer marks User.email as @unique; uniqueness is enforced here only
-- for rows where deletedAt IS NULL.
CREATE UNIQUE INDEX "User_email_active_key" ON "User" ("email") WHERE "deletedAt" IS NULL;

-- Same pattern for Depot.slug so a depot can be re-created under the same
-- slug after soft-delete.
CREATE UNIQUE INDEX "Depot_slug_active_key" ON "Depot" ("slug") WHERE "deletedAt" IS NULL;

-- Recreate the overlap-exclusion constraint using tstzrange. Both inputs
-- are timestamptz so no session-timezone conversion happens, and the
-- resulting range function is IMMUTABLE (Postgres requires IMMUTABLE for
-- index expressions). Bounds default to `[lower, upper)` — a rental
-- ending at 11:00 and another starting at 11:00 is NOT a conflict. The
-- 2-hour buffer between bookings is applied at the application layer,
-- not at this DB constraint. See
-- src/server/services/availability.ts for the advisory-lock path.
ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_no_overlap"
EXCLUDE USING gist (
  "vehicleId" WITH =,
  tstzrange("pickupDateTime", "returnDateTime") WITH &&
)
WHERE (
  "vehicleId" IS NOT NULL
  AND "status" IN ('CONFIRMED', 'CHECKED_OUT', 'ACTIVE', 'OVERDUE')
);
