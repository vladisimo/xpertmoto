-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "LoyaltyLedgerDirection" AS ENUM ('EARN', 'BURN', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'HIDDEN', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'PAID', 'FRAUD', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ServiceDispatchType" AS ENUM ('FUEL_DELIVERY', 'EXTRA_HELMET', 'PHONE_MOUNT', 'SCOOTER_SWAP', 'ROADSIDE', 'BATTERY_JUMP');

-- CreateEnum
CREATE TYPE "ServiceDispatchStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DemandEventImpact" AS ENUM ('BOOST', 'DIP');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('HOTEL', 'HOSTEL', 'TOUR_OPERATOR', 'AGGREGATOR', 'CORPORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerTransactionStatus" AS ENUM ('PENDING', 'PAYABLE', 'PAID', 'DISPUTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'VOIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CART_RECOVERY_HOLD';
ALTER TYPE "NotificationType" ADD VALUE 'CART_RECOVERY_DISCOUNT';
ALTER TYPE "NotificationType" ADD VALUE 'CART_RECOVERY_LAST_CHANCE';
ALTER TYPE "NotificationType" ADD VALUE 'EXCESS_UPSELL_OFFER';
ALTER TYPE "NotificationType" ADD VALUE 'GIFT_CARD_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'GIFT_CARD_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'POST_TRIP_REVIEW_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'LOYALTY_TIER_UPGRADE';
ALTER TYPE "NotificationType" ADD VALUE 'LOYALTY_POINTS_EARNED';
ALTER TYPE "NotificationType" ADD VALUE 'REFERRAL_QUALIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RENEWED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_PAUSED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTNER_BOOKING_ATTRIBUTED';
ALTER TYPE "NotificationType" ADD VALUE 'ZONE_BREACH_WARNING';
ALTER TYPE "NotificationType" ADD VALUE 'FUEL_DELIVERY_DISPATCHED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentType" ADD VALUE 'GIFT_CARD_PURCHASE';
ALTER TYPE "PaymentType" ADD VALUE 'GIFT_CARD_REDEMPTION';
ALTER TYPE "PaymentType" ADD VALUE 'SUBSCRIPTION_CHARGE';
ALTER TYPE "PaymentType" ADD VALUE 'ZONE_SURCHARGE';
ALTER TYPE "PaymentType" ADD VALUE 'FUEL_DELIVERY_FEE';
ALTER TYPE "PaymentType" ADD VALUE 'CLEANING_FEE';
ALTER TYPE "PaymentType" ADD VALUE 'PARTNER_COMMISSION_PAYOUT';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cleaningFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "fuelDeliveryTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "partnerCode" TEXT,
ADD COLUMN     "partnerId" TEXT,
ADD COLUMN     "recoveryStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "yieldMultiplier" DECIMAL(5,3) NOT NULL DEFAULT 1,
ADD COLUMN     "zoneSurchargeTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BookingInsurance" ADD COLUMN     "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'WIZARD';

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyTier" "LoyaltyTier" NOT NULL DEFAULT 'SILVER',
ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referralCreditBalance" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Infringement" ADD COLUMN     "adminFee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "photos" TEXT[],
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "syndicatedTo" TEXT[],
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "vehicleCategoryId" TEXT,
    "depotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT,
    "refereeEmail" TEXT,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardAmount" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "refereeDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "qualifyingBookingId" TEXT,
    "qualifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "direction" "LoyaltyLedgerDirection" NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalZone" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "polygon" JSONB,
    "allowStateCrossing" BOOLEAN NOT NULL DEFAULT false,
    "perKmSurchargeCents" INTEGER NOT NULL DEFAULT 35,
    "borderCrossingFeeCents" INTEGER NOT NULL DEFAULT 10000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "odometerKm" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeedEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "speedKph" DOUBLE PRECISION NOT NULL,
    "thresholdKph" DOUBLE PRECISION NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDispatch" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "ServiceDispatchType" NOT NULL,
    "status" "ServiceDispatchStatus" NOT NULL DEFAULT 'REQUESTED',
    "feeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToId" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deliveryLat" DOUBLE PRECISION,
    "deliveryLng" DOUBLE PRECISION,
    "deliveryNote" TEXT,
    "proofPhotoUrl" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRecommendation" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "depotId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "baseMultiplier" DECIMAL(5,3) NOT NULL DEFAULT 1,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forwardBookingPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "demandScore" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "reasonCodes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "overrideMultiplier" DECIMAL(5,3),
    "overriddenById" TEXT,
    "overriddenAt" TIMESTAMP(3),

    CONSTRAINT "PriceRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "multiplier" DECIMAL(5,3) NOT NULL,
    "impact" "DemandEventImpact" NOT NULL DEFAULT 'BOOST',
    "depotIds" TEXT[],
    "categoryIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryIds" TEXT[],
    "priceMonthlyAud" DECIMAL(10,2) NOT NULL,
    "includedDays" INTEGER,
    "includedKm" INTEGER,
    "overageDayRate" DECIMAL(10,2),
    "overageKmRate" DECIMAL(10,2),
    "includesInsurance" BOOLEAN NOT NULL DEFAULT false,
    "includesHelmet" BOOLEAN NOT NULL DEFAULT true,
    "maxSwapsPerMonth" INTEGER NOT NULL DEFAULT 4,
    "isBusinessPlan" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessAccountId" TEXT,
    "planId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "usageSnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionUsage" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "daysUsed" INTEGER NOT NULL DEFAULT 0,
    "kmUsed" INTEGER NOT NULL DEFAULT 0,
    "swapsUsed" INTEGER NOT NULL DEFAULT 0,
    "overageCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abn" TEXT,
    "contactUserId" TEXT,
    "billingEmail" TEXT,
    "addressLine1" TEXT,
    "suburb" TEXT,
    "state" TEXT,
    "postcode" TEXT,
    "creditLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "stripeConnectAccountId" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "trackingCode" TEXT,
    "websiteUrl" TEXT,
    "depotIds" TEXT[],
    "widgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerUser" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerTransaction" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingTotal" DECIMAL(12,2) NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "status" "PartnerTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "stripeTransferId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "initialAmount" DECIMAL(10,2) NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL,
    "purchasedById" TEXT,
    "purchaserEmail" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "personalMessage" TEXT,
    "scheduledDeliveryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardTransaction" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "bookingId" TEXT,
    "paymentId" TEXT,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"("bookingId");

-- CreateIndex
CREATE INDEX "Review_status_publishedAt_idx" ON "Review"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Review_customerId_idx" ON "Review"("customerId");

-- CreateIndex
CREATE INDEX "Review_rating_idx" ON "Review"("rating");

-- CreateIndex
CREATE INDEX "Review_depotId_idx" ON "Review"("depotId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");

-- CreateIndex
CREATE INDEX "Referral_refereeId_idx" ON "Referral"("refereeId");

-- CreateIndex
CREATE INDEX "Referral_code_idx" ON "Referral"("code");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_userId_createdAt_idx" ON "LoyaltyLedger"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LoyaltyLedger_bookingId_idx" ON "LoyaltyLedger"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalZone_bookingId_key" ON "RentalZone"("bookingId");

-- CreateIndex
CREATE INDEX "RentalZone_bookingId_idx" ON "RentalZone"("bookingId");

-- CreateIndex
CREATE INDEX "ZoneEvent_bookingId_eventAt_idx" ON "ZoneEvent"("bookingId", "eventAt");

-- CreateIndex
CREATE INDEX "ZoneEvent_kind_idx" ON "ZoneEvent"("kind");

-- CreateIndex
CREATE INDEX "SpeedEvent_bookingId_eventAt_idx" ON "SpeedEvent"("bookingId", "eventAt");

-- CreateIndex
CREATE INDEX "ServiceDispatch_bookingId_idx" ON "ServiceDispatch"("bookingId");

-- CreateIndex
CREATE INDEX "ServiceDispatch_status_idx" ON "ServiceDispatch"("status");

-- CreateIndex
CREATE INDEX "ServiceDispatch_type_idx" ON "ServiceDispatch"("type");

-- CreateIndex
CREATE INDEX "PriceRecommendation_date_idx" ON "PriceRecommendation"("date");

-- CreateIndex
CREATE INDEX "PriceRecommendation_depotId_date_idx" ON "PriceRecommendation"("depotId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRecommendation_date_depotId_categoryId_key" ON "PriceRecommendation"("date", "depotId", "categoryId");

-- CreateIndex
CREATE INDEX "DemandEvent_isActive_startDate_endDate_idx" ON "DemandEvent"("isActive", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_isActive_idx" ON "SubscriptionPlan"("isActive");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_isBusinessPlan_idx" ON "SubscriptionPlan"("isBusinessPlan");

-- CreateIndex
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_businessAccountId_idx" ON "Subscription"("businessAccountId");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionUsage_subscriptionId_periodStart_key" ON "SubscriptionUsage"("subscriptionId", "periodStart");

-- CreateIndex
CREATE INDEX "BusinessAccount_status_idx" ON "BusinessAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_slug_key" ON "Partner"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_trackingCode_key" ON "Partner"("trackingCode");

-- CreateIndex
CREATE INDEX "Partner_isActive_idx" ON "Partner"("isActive");

-- CreateIndex
CREATE INDEX "Partner_type_idx" ON "Partner"("type");

-- CreateIndex
CREATE INDEX "PartnerUser_userId_idx" ON "PartnerUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUser_partnerId_userId_key" ON "PartnerUser"("partnerId", "userId");

-- CreateIndex
CREATE INDEX "PartnerTransaction_partnerId_status_idx" ON "PartnerTransaction"("partnerId", "status");

-- CreateIndex
CREATE INDEX "PartnerTransaction_status_idx" ON "PartnerTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerTransaction_bookingId_partnerId_key" ON "PartnerTransaction"("bookingId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE INDEX "GiftCard_status_idx" ON "GiftCard"("status");

-- CreateIndex
CREATE INDEX "GiftCard_recipientEmail_idx" ON "GiftCard"("recipientEmail");

-- CreateIndex
CREATE INDEX "GiftCard_purchasedById_idx" ON "GiftCard"("purchasedById");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_giftCardId_idx" ON "GiftCardTransaction"("giftCardId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_bookingId_idx" ON "GiftCardTransaction"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Addon_isActive_idx" ON "Addon"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Addon_depotId_idx" ON "Addon"("depotId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BondLedger_customerId_idx" ON "BondLedger"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BondLedger_status_idx" ON "BondLedger"("status");

-- CreateIndex
CREATE INDEX "Booking_partnerId_idx" ON "Booking"("partnerId");

-- CreateIndex
CREATE INDEX "Booking_subscriptionId_idx" ON "Booking"("subscriptionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingAddon_bookingId_idx" ON "BookingAddon"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingAddon_addonId_idx" ON "BookingAddon"("addonId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingInsurance_bookingId_idx" ON "BookingInsurance"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingInsurance_insuranceOptionId_idx" ON "BookingInsurance"("insuranceOptionId");

-- CreateIndex
CREATE INDEX "BookingInsurance_source_idx" ON "BookingInsurance"("source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingNote_bookingId_idx" ON "BookingNote"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingNote_userId_idx" ON "BookingNote"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BookingStatusLog_bookingId_idx" ON "BookingStatusLog"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_referralCode_key" ON "CustomerProfile"("referralCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CustomerProfile_riskRating_idx" ON "CustomerProfile"("riskRating");

-- CreateIndex
CREATE INDEX "CustomerProfile_loyaltyTier_idx" ON "CustomerProfile"("loyaltyTier");

-- CreateIndex
CREATE INDEX "CustomerProfile_referralCode_idx" ON "CustomerProfile"("referralCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Depot_isActive_idx" ON "Depot"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Discount_isActive_idx" ON "Discount"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IncidentDocument_incidentId_idx" ON "IncidentDocument"("incidentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IncidentNote_incidentId_idx" ON "IncidentNote"("incidentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IncidentNote_userId_idx" ON "IncidentNote"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IncidentPhoto_incidentId_idx" ON "IncidentPhoto"("incidentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InspectionItem_inspectionId_idx" ON "InspectionItem"("inspectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InspectionPhoto_inspectionId_idx" ON "InspectionPhoto"("inspectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InsuranceOption_isActive_idx" ON "InsuranceOption"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_bookingId_idx" ON "Invoice"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaintenanceLog_workOrderId_idx" ON "MaintenanceLog"("workOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaintenancePart_workOrderId_idx" ON "MaintenancePart"("workOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaintenanceSchedule_vehicleId_idx" ON "MaintenanceSchedule"("vehicleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Package_categoryId_idx" ON "Package"("categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Package_isActive_idx" ON "Package"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PricingRule_categoryId_idx" ON "PricingRule"("categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PricingRule_seasonId_idx" ON "PricingRule"("seasonId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PricingRule_isActive_idx" ON "PricingRule"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTicketNote_ticketId_idx" ON "SupportTicketNote"("ticketId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SupportTicketNote_userId_idx" ON "SupportTicketNote"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleCategory_isActive_idx" ON "VehicleCategory"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleDocument_vehicleId_idx" ON "VehicleDocument"("vehicleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleImage_vehicleId_idx" ON "VehicleImage"("vehicleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleStatusLog_vehicleId_idx" ON "VehicleStatusLog"("vehicleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleTransfer_vehicleId_idx" ON "VehicleTransfer"("vehicleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleTransfer_fromDepotId_idx" ON "VehicleTransfer"("fromDepotId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleTransfer_toDepotId_idx" ON "VehicleTransfer"("toDepotId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VehicleTransfer_status_idx" ON "VehicleTransfer"("status");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "VehicleCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeId_fkey" FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_qualifyingBookingId_fkey" FOREIGN KEY ("qualifyingBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalZone" ADD CONSTRAINT "RentalZone_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneEvent" ADD CONSTRAINT "ZoneEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeedEvent" ADD CONSTRAINT "SpeedEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDispatch" ADD CONSTRAINT "ServiceDispatch_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "BusinessAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionUsage" ADD CONSTRAINT "SubscriptionUsage_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerUser" ADD CONSTRAINT "PartnerUser_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerTransaction" ADD CONSTRAINT "PartnerTransaction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerTransaction" ADD CONSTRAINT "PartnerTransaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

