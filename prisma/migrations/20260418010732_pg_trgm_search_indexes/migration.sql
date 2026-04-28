-- Enable trigram matching for substring/ILIKE search.
-- Without this, `WHERE col ILIKE '%query%'` is always a Seq Scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- User: staff-customer.list + communication compose + walk-in booking sheet.
-- Lower(col) GIN + gin_trgm_ops so the planner can use the index with
-- `col ILIKE '%x%'` — Prisma's `contains: { mode: "insensitive" }` emits
-- exactly that form, so no app changes are required.
CREATE INDEX "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "User_firstName_trgm_idx" ON "User" USING GIN ("firstName" gin_trgm_ops);
CREATE INDEX "User_lastName_trgm_idx" ON "User" USING GIN ("lastName" gin_trgm_ops);
CREATE INDEX "User_phone_trgm_idx" ON "User" USING GIN ("phone" gin_trgm_ops);

-- Booking: staff-booking.list reference search
CREATE INDEX "Booking_bookingReference_trgm_idx" ON "Booking" USING GIN ("bookingReference" gin_trgm_ops);

-- Vehicle: fleet.list by internal code / rego / make / model
CREATE INDEX "Vehicle_internalCode_trgm_idx" ON "Vehicle" USING GIN ("internalCode" gin_trgm_ops);
CREATE INDEX "Vehicle_rego_trgm_idx" ON "Vehicle" USING GIN ("rego" gin_trgm_ops);
CREATE INDEX "Vehicle_make_trgm_idx" ON "Vehicle" USING GIN ("make" gin_trgm_ops);
CREATE INDEX "Vehicle_model_trgm_idx" ON "Vehicle" USING GIN ("model" gin_trgm_ops);
