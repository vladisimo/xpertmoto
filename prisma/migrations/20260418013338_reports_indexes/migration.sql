-- Reports performance indexes
-- Payment: filter by type within a date window (finance/refund reports)
CREATE INDEX IF NOT EXISTS "Payment_type_createdAt_idx" ON "Payment"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "Payment_type_status_createdAt_idx" ON "Payment"("type", "status", "createdAt");

-- Incident: frequency reports filter by createdAt alone
CREATE INDEX IF NOT EXISTS "Incident_createdAt_idx" ON "Incident"("createdAt");

-- Infringement: status queries + date-window reports
CREATE INDEX IF NOT EXISTS "Infringement_createdAt_idx" ON "Infringement"("createdAt");
CREATE INDEX IF NOT EXISTS "Infringement_status_idx" ON "Infringement"("status");
