-- VisitorEvent dedup constraint.
--
-- The client flush retries on network failure and the ingest mutation uses
-- createMany({ skipDuplicates: true }) — a silent no-op without a unique
-- constraint, so redelivered batches inserted duplicate rows and inflated
-- funnel/behaviour counts.
--
-- Step 1: remove existing duplicates, keeping the lowest id per
-- (sessionId, kind, occurredAt) triple, or the constraint below fails on
-- historical data.
DELETE FROM "VisitorEvent" v
USING "VisitorEvent" keeper
WHERE keeper."sessionId" = v."sessionId"
  AND keeper."kind" = v."kind"
  AND keeper."occurredAt" = v."occurredAt"
  AND keeper."id" < v."id";

-- Step 2: the constraint. Its backing index also serves
-- (sessionId, kind, occurredAt) funnel scans.
CREATE UNIQUE INDEX "VisitorEvent_sessionId_kind_occurredAt_key" ON "VisitorEvent"("sessionId", "kind", "occurredAt");
