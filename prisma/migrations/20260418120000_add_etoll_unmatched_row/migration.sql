-- CreateTable
CREATE TABLE "EtollUnmatchedRow" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalHash" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "rego" TEXT NOT NULL,
    "concession" TEXT NOT NULL,
    "gantryCode" TEXT,
    "rawDetails" TEXT,
    "amountCents" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAction" TEXT,
    "resolvedInfringementId" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtollUnmatchedRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EtollUnmatchedRow_externalHash_key" ON "EtollUnmatchedRow"("externalHash");

-- CreateIndex
CREATE INDEX "EtollUnmatchedRow_accountId_resolvedAt_idx" ON "EtollUnmatchedRow"("accountId", "resolvedAt");

-- CreateIndex
CREATE INDEX "EtollUnmatchedRow_eventAt_idx" ON "EtollUnmatchedRow"("eventAt");

-- AddForeignKey
ALTER TABLE "EtollUnmatchedRow" ADD CONSTRAINT "EtollUnmatchedRow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EtollAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
