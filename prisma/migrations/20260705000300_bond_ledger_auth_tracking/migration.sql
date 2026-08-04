-- Track the CURRENT bond authorisation's age and the chain of re-auths so
-- the rolling re-hold job can keep long-hire bonds alive past the
-- card-network auth expiry (~7 days on Visa).
ALTER TABLE "BondLedger" ADD COLUMN "authorizedAt" TIMESTAMPTZ;
ALTER TABLE "BondLedger" ADD COLUMN "reauthCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BondLedger" ADD COLUMN "authHistory" JSONB NOT NULL DEFAULT '[]';

-- Existing holds were authorised when the ledger row was created.
UPDATE "BondLedger" SET "authorizedAt" = "createdAt" WHERE "stripePaymentIntentId" IS NOT NULL;
