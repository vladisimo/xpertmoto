-- Prod-safe variant of this migration — uses CREATE INDEX CONCURRENTLY so
-- writes are not blocked while indexes build on large tables. Must be run
-- OUTSIDE a transaction (direct psql, not via `prisma migrate deploy`).
--
-- Usage:
--   psql "$DATABASE_URL" -f prod-concurrent.sql
--   prisma migrate resolve --applied 20260418005316_fk_and_active_indexes
--
-- `IF NOT EXISTS` makes every statement idempotent so a re-run (e.g. after
-- a failed concurrent build) is safe.

-- Addon
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Addon_isActive_idx" ON "Addon"("isActive");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Addon_depotId_idx" ON "Addon"("depotId");

-- BondLedger
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BondLedger_customerId_idx" ON "BondLedger"("customerId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BondLedger_status_idx" ON "BondLedger"("status");

-- BookingAddon
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BookingAddon_bookingId_idx" ON "BookingAddon"("bookingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BookingAddon_addonId_idx" ON "BookingAddon"("addonId");

-- BookingInsurance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BookingInsurance_bookingId_idx" ON "BookingInsurance"("bookingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BookingInsurance_insuranceOptionId_idx" ON "BookingInsurance"("insuranceOptionId");

-- BookingNote
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BookingNote_bookingId_idx" ON "BookingNote"("bookingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BookingNote_userId_idx" ON "BookingNote"("userId");

-- BookingStatusLog
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BookingStatusLog_bookingId_idx" ON "BookingStatusLog"("bookingId");

-- CreditNote
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CustomerProfile
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CustomerProfile_riskRating_idx" ON "CustomerProfile"("riskRating");

-- Depot
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Depot_isActive_idx" ON "Depot"("isActive");

-- Discount
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Discount_isActive_idx" ON "Discount"("isActive");

-- IncidentDocument
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IncidentDocument_incidentId_idx" ON "IncidentDocument"("incidentId");

-- IncidentNote
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IncidentNote_incidentId_idx" ON "IncidentNote"("incidentId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IncidentNote_userId_idx" ON "IncidentNote"("userId");

-- IncidentPhoto
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IncidentPhoto_incidentId_idx" ON "IncidentPhoto"("incidentId");

-- InspectionItem
CREATE INDEX CONCURRENTLY IF NOT EXISTS "InspectionItem_inspectionId_idx" ON "InspectionItem"("inspectionId");

-- InspectionPhoto
CREATE INDEX CONCURRENTLY IF NOT EXISTS "InspectionPhoto_inspectionId_idx" ON "InspectionPhoto"("inspectionId");

-- InsuranceOption
CREATE INDEX CONCURRENTLY IF NOT EXISTS "InsuranceOption_isActive_idx" ON "InsuranceOption"("isActive");

-- Invoice
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Invoice_bookingId_idx" ON "Invoice"("bookingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");

-- MaintenanceLog
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MaintenanceLog_workOrderId_idx" ON "MaintenanceLog"("workOrderId");

-- MaintenancePart
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MaintenancePart_workOrderId_idx" ON "MaintenancePart"("workOrderId");

-- MaintenanceSchedule
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MaintenanceSchedule_vehicleId_idx" ON "MaintenanceSchedule"("vehicleId");

-- Package
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Package_categoryId_idx" ON "Package"("categoryId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Package_isActive_idx" ON "Package"("isActive");

-- PricingRule
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PricingRule_categoryId_idx" ON "PricingRule"("categoryId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PricingRule_seasonId_idx" ON "PricingRule"("seasonId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PricingRule_isActive_idx" ON "PricingRule"("isActive");

-- SupportTicketNote
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupportTicketNote_ticketId_idx" ON "SupportTicketNote"("ticketId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupportTicketNote_userId_idx" ON "SupportTicketNote"("userId");

-- VehicleCategory
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleCategory_isActive_idx" ON "VehicleCategory"("isActive");

-- VehicleDocument
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleDocument_vehicleId_idx" ON "VehicleDocument"("vehicleId");

-- VehicleImage
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleImage_vehicleId_idx" ON "VehicleImage"("vehicleId");

-- VehicleStatusLog
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleStatusLog_vehicleId_idx" ON "VehicleStatusLog"("vehicleId");

-- VehicleTransfer
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleTransfer_vehicleId_idx" ON "VehicleTransfer"("vehicleId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleTransfer_fromDepotId_idx" ON "VehicleTransfer"("fromDepotId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleTransfer_toDepotId_idx" ON "VehicleTransfer"("toDepotId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleTransfer_status_idx" ON "VehicleTransfer"("status");
