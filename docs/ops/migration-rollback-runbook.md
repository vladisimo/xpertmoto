# Migration rollback runbook

Prisma's migration model is append-only — there's no built-in `prisma migrate
down`. Rollback means applying a new compensating migration that reverses the
previous one. This runbook codifies the pattern so on-call has a deterministic
playbook when a migration ships a bug.

## Decision tree on incident

1. **Is the data corrupted?** (wrong values, orphaned foreign keys)
   - Yes → restore from the latest pre-migration `DatabaseBackup` (see
     [database-restore.md](./database-restore.md)) and replay only post-backup
     rows forward. Do NOT attempt a forward-fix migration.
   - No → continue.
2. **Is the bug in a destructive change?** (dropped column, renamed table)
   - Yes → restore from backup. Dropped columns are unrecoverable otherwise.
   - No → continue.
3. **Is the bug in an additive change?** (new column, new index, new table)
   - Yes → author a compensating migration that drops the offender.

## Pattern — compensating additive rollback

```bash
# 1. Author a new migration that reverses the bad one.
npm run db:migrate -- --name rollback_<bad_migration_name> --create-only

# 2. Hand-edit the generated SQL to DROP / ALTER what was added.
#    Example: the bad migration added `Vehicle.newColumn` — the comp.
#    should DROP COLUMN "newColumn".

# 3. Sanity check locally.
npx prisma migrate dev  # applies to local dev DB
npm run typecheck       # proves no code references the dropped shape

# 4. Deploy.
git push && merge to main → CI runs prisma migrate deploy on prod.
```

## Discipline

- **Every new migration lands with its rollback already drafted** — either as
  a commit on a rollback branch or as a `rollback.sql` inside the migration
  folder (ignored by Prisma, consumed by this runbook).
- **Destructive changes go behind a feature flag** so code stops using the
  column BEFORE the migration drops it. Two-phase: flag → deploy → migrate.
- **Never use `prisma db push` against the shared dev DB** (already enforced
  by [CLAUDE.md](../../CLAUDE.md) §3). `db push` doesn't generate a migration
  file, which means you have no rollback artifact.

## Compensating rollback templates

### Added a column
```sql
ALTER TABLE "TableName" DROP COLUMN "colName";
```

### Added a table
```sql
DROP TABLE "TableName";
```

### Added an index
```sql
DROP INDEX "TableName_field_idx";
```

### Changed a column default
```sql
ALTER TABLE "TableName" ALTER COLUMN "col" SET DEFAULT <old_default>;
-- Plus a data-fill UPDATE if new rows used the wrong default.
```

### Renamed a column (two-phase only)
```sql
ALTER TABLE "TableName" RENAME COLUMN "newName" TO "oldName";
```

### Added a NOT NULL + backfill (Prisma's default for required fields)
```sql
-- Drop the NOT NULL constraint.
ALTER TABLE "TableName" ALTER COLUMN "col" DROP NOT NULL;
-- Optionally DROP COLUMN if the rollback is total.
```

## After a rollback

1. Verify the schema state matches what the app expects:
   `npx prisma validate && npx prisma db pull --print | diff - prisma/schema.prisma`
2. Confirm the typecheck and build pass on the deployed revision.
3. Post-mortem: what made the original migration dangerous? Add a test.
