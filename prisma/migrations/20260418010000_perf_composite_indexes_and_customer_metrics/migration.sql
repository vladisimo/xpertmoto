-- PROD ROLLOUT NOTE:
-- Prisma runs this whole file inside one transaction, so `CREATE INDEX CONCURRENTLY`
-- is NOT supported here (Postgres rejects it inside a transaction block).
-- For large prod tables, apply the CONCURRENTLY variant in `prod-concurrent.sql`
-- via psql BEFORE running `prisma migrate deploy`, then run:
--   psql "$DATABASE_URL" -f prod-concurrent.sql
--   psql "$DATABASE_URL" -c "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
--     VALUES (gen_random_uuid()::text, '', now(), '20260418010000_perf_composite_indexes_and_customer_metrics', null, null, now(), 1);"
-- or `prisma migrate resolve --applied 20260418010000_perf_composite_indexes_and_customer_metrics`.
-- The regular (non-concurrent) form below is safe for dev and fresh prod databases.

-- AlterTable
ALTER TABLE "CustomerProfile"
    ADD COLUMN "completedBookings" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "incidentCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastBookingAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Booking_depotId_status_pickupDateTime_idx" ON "Booking"("depotId", "status", "pickupDateTime");
CREATE INDEX "Booking_depotId_pickupDateTime_returnDateTime_idx" ON "Booking"("depotId", "pickupDateTime", "returnDateTime");
CREATE INDEX "Booking_customerId_status_pickupDateTime_idx" ON "Booking"("customerId", "status", "pickupDateTime" DESC);
CREATE INDEX "Booking_status_returnDateTime_idx" ON "Booking"("status", "returnDateTime");
CREATE INDEX "Booking_vehicleId_status_pickupDateTime_idx" ON "Booking"("vehicleId", "status", "pickupDateTime");

-- CreateIndex
CREATE INDEX "Vehicle_depotId_status_categoryId_idx" ON "Vehicle"("depotId", "status", "categoryId");
CREATE INDEX "Vehicle_status_nextServiceDueKm_idx" ON "Vehicle"("status", "nextServiceDueKm");

-- CreateIndex
CREATE INDEX "Payment_bookingId_status_createdAt_idx" ON "Payment"("bookingId", "status", "createdAt");
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Inspection_vehicleId_dateTime_idx" ON "Inspection"("vehicleId", "dateTime" DESC);
CREATE INDEX "Inspection_bookingId_type_idx" ON "Inspection"("bookingId", "type");

-- CreateIndex
CREATE INDEX "MaintenanceWorkOrder_depotId_status_scheduledStartAt_idx" ON "MaintenanceWorkOrder"("depotId", "status", "scheduledStartAt");

-- CreateIndex
CREATE INDEX "Incident_vehicleId_createdAt_idx" ON "Incident"("vehicleId", "createdAt" DESC);
CREATE INDEX "Incident_bookingId_status_idx" ON "Incident"("bookingId", "status");
CREATE INDEX "Incident_status_idx" ON "Incident"("status");
