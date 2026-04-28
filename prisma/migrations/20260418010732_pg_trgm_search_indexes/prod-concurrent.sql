-- Prod-safe variant — CREATE INDEX CONCURRENTLY so writes aren't blocked
-- while GIN indexes build on large tables. Must be run OUTSIDE a
-- transaction (direct psql, not via `prisma migrate deploy`).
--
-- Usage:
--   psql "$DATABASE_URL" -f prod-concurrent.sql
--   prisma migrate resolve --applied 20260418010732_pg_trgm_search_indexes
--
-- CREATE EXTENSION takes a lightweight lock; safe to leave non-concurrent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- User
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_firstName_trgm_idx" ON "User" USING GIN ("firstName" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_lastName_trgm_idx" ON "User" USING GIN ("lastName" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_phone_trgm_idx" ON "User" USING GIN ("phone" gin_trgm_ops);

-- Booking
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_bookingReference_trgm_idx" ON "Booking" USING GIN ("bookingReference" gin_trgm_ops);

-- Vehicle
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Vehicle_internalCode_trgm_idx" ON "Vehicle" USING GIN ("internalCode" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Vehicle_rego_trgm_idx" ON "Vehicle" USING GIN ("rego" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Vehicle_make_trgm_idx" ON "Vehicle" USING GIN ("make" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Vehicle_model_trgm_idx" ON "Vehicle" USING GIN ("model" gin_trgm_ops);
