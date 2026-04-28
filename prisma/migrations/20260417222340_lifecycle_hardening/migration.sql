-- A5: add scheduled window to MaintenanceWorkOrder so availability can
-- exclude vehicles with an overlapping scheduled service. OPEN /
-- ASSIGNED / IN_PROGRESS / AWAITING_PARTS work orders whose window
-- intersects a requested booking are treated as a conflict.
ALTER TABLE "MaintenanceWorkOrder"
  ADD COLUMN "scheduledStartAt" TIMESTAMP(3),
  ADD COLUMN "scheduledEndAt"   TIMESTAMP(3);

CREATE INDEX "MaintenanceWorkOrder_vehicleId_scheduledStartAt_scheduledEndAt_idx"
  ON "MaintenanceWorkOrder" ("vehicleId", "scheduledStartAt", "scheduledEndAt");

-- C5: per-pair one-way fees. Same-depot rentals don't touch this.
-- `allowed=false` marks pairs we refuse to rent across (e.g.
-- Brisbane↔Melbourne — too far for a scooter). Unique on the pair.
CREATE TABLE "OneWayFee" (
  "id"          TEXT          NOT NULL,
  "fromDepotId" TEXT          NOT NULL,
  "toDepotId"   TEXT          NOT NULL,
  "feeAmount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "allowed"     BOOLEAN       NOT NULL DEFAULT true,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "OneWayFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OneWayFee_fromDepotId_toDepotId_key"
  ON "OneWayFee" ("fromDepotId", "toDepotId");

ALTER TABLE "OneWayFee"
  ADD CONSTRAINT "OneWayFee_fromDepotId_fkey"
    FOREIGN KEY ("fromDepotId") REFERENCES "Depot" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OneWayFee"
  ADD CONSTRAINT "OneWayFee_toDepotId_fkey"
    FOREIGN KEY ("toDepotId") REFERENCES "Depot" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- B2: escalation stage counter on Booking so the 15-min overdue job
-- can fire the right template at each rung (T+1h, T+12h, T+24h, T+72h)
-- without repeating itself. Stored on the row to keep the job stateless.
ALTER TABLE "Booking"
  ADD COLUMN "overdueStage" INTEGER NOT NULL DEFAULT 0;
