-- Partial unique indexes on (email/slug) WHERE deletedAt IS NULL were added
-- in 20260418230000_lifecycle_hardening_phase2 to let soft-deleted rows
-- coexist with re-registrations. That approach conflicted with the
-- TypeScript type for `prisma.user.findUnique({ where: { email } })` which
-- callers (including NextAuth's PrismaAdapter) rely on.
--
-- The cleaner solution: keep the standard UNIQUE constraint in place, and
-- have the `anonymiseUser` / `archiveDepot` services overwrite email / slug
-- with a unique placeholder on soft-delete, freeing the original identifier
-- for re-use. See src/server/services/anonymise-user.ts.
DROP INDEX IF EXISTS "User_email_active_key";
DROP INDEX IF EXISTS "Depot_slug_active_key";
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");
CREATE UNIQUE INDEX "Depot_slug_key" ON "Depot" ("slug");
