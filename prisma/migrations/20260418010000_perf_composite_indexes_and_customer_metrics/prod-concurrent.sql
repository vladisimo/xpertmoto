-- Prod-safe variant of this migration — uses CREATE INDEX CONCURRENTLY so
-- writes are not blocked while indexes build on large tables. Must be run
-- OUTSIDE a transaction (direct psql, not via `prisma migrate deploy`).
--
-- Usage:
--   psql "$DATABASE_URL" -f prod-concurrent.sql
--   prisma migrate resolve --applied 20260418010000_perf_composite_indexes_and_customer_metrics
--
-- `IF NOT EXISTS` makes every statement idempotent so a re-run (e.g. after
-- a failed concurrent build) is safe.

-- AlterTable — non-index changes are short-lived and safe in-place.
ALTER TABLE "CustomerProfile"
    ADD COLUMN IF NOT EXISTS "completedBookings" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "incidentCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lastBookingAt" TIMESTAMP(3);

-- Booking
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_depotId_status_pickupDateTime_idx" ON "Booking"("depotId", "status", "pickupDateTime");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_depotId_pickupDateTime_returnDateTime_idx" ON "Booking"("depotId", "pickupDateTime", "returnDateTime");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_customerId_status_pickupDateTime_idx" ON "Booking"("customerId", "status", "pickupDateTime" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_status_returnDateTime_idx" ON "Booking"("status", "returnDateTime");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_vehicleId_status_pickupDateTime_idx" ON "Booking"("vehicleId", "status", "pickupDateTime");

-- Vehicle
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Vehicle_depotId_status_categoryId_idx" ON "Vehicle"("depotId", "status", "categoryId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Vehicle_status_nextServiceDueKm_idx" ON "Vehicle"("status", "nextServiceDueKm");

-- Payment
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_bookingId_status_createdAt_idx" ON "Payment"("bookingId", "status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- Inspection
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Inspection_vehicleId_dateTime_idx" ON "Inspection"("vehicleId", "dateTime" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Inspection_bookingId_type_idx" ON "Inspection"("bookingId", "type");

-- MaintenanceWorkOrder
CREATE INDEX CONCURRENTLY IF NOT EXISTS "MaintenanceWorkOrder_depotId_status_scheduledStartAt_idx" ON "MaintenanceWorkOrder"("depotId", "status", "scheduledStartAt");

-- Incident
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Incident_vehicleId_createdAt_idx" ON "Incident"("vehicleId", "createdAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Incident_bookingId_status_idx" ON "Incident"("bookingId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Incident_status_idx" ON "Incident"("status");
