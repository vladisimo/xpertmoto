-- Drop the default placed on NotificationTemplate.updatedAt by the initial
-- add_communications_hub migration. Prisma Client manages updatedAt itself
-- via @updatedAt, so the column should not have a DB-side default.
ALTER TABLE "NotificationTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;
