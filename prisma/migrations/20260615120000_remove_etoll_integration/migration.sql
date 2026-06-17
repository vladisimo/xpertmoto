-- Remove the legacy NSW E-Toll integration. Linkt (Transurban) is now the
-- sole toll provider. Historical toll charges are unaffected: they live in
-- `Infringement` rows (type = TOLL), not in these tables.

-- DropForeignKey
ALTER TABLE "EtollSync" DROP CONSTRAINT IF EXISTS "EtollSync_accountId_fkey";

-- DropForeignKey
ALTER TABLE "EtollUnmatchedRow" DROP CONSTRAINT IF EXISTS "EtollUnmatchedRow_accountId_fkey";

-- DropTable
DROP TABLE "EtollSync";

-- DropTable
DROP TABLE "EtollUnmatchedRow";

-- DropTable
DROP TABLE "EtollAccount";

-- DropEnum
DROP TYPE "EtollSyncStatus";
