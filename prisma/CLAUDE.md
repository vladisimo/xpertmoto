# prisma/ — schema and migration rules

This file is loaded when Claude reads or edits files in `prisma/`. The root [CLAUDE.md](../CLAUDE.md) covers stack-wide change management; this file is the schema-specific contract.

For a step-by-step walkthrough of a schema change, run the `prisma-migration` skill at [.claude/skills/prisma-migration.md](../.claude/skills/prisma-migration.md).

## Scope vs spec

The original CLAUDE.md spec listed ~60 entities. The actual schema has **~117 models** across 63+ migrations (April 2026). Scope additions include gift cards, referrals, eToLL integration, telematics revenue, subscriptions, loyalty, partner programs, support-AI tickets, yield pricing. Treat the entity lists in any historical spec doc as a starting point, not the inventory — `prisma/schema.prisma` is the source of truth.

## Schema-edit discipline (enforced)

- Every edit to [schema.prisma](schema.prisma) must ship with a corresponding migration in the same change: `npm run db:migrate -- --name <descriptive_snake_case>`.
- The PreToolUse hook [`.claude/hooks/pre/protect-schema.sh`](../.claude/hooks/pre/protect-schema.sh) **blocks** schema edits unless the user turn mentions "migration" or "schema change" — be explicit, don't try to bypass.
- Never use `prisma db push` against any non-localhost DATABASE_URL. The `guard-bash.sh` PreToolUse hook will block it.
- Never edit files under `prisma/migrations/` after they have been committed and applied to a shared environment. Roll forward with a new migration instead.

## Conventions in `schema.prisma`

| Convention | Detail |
|---|---|
| Timestamps | Every model has `createdAt @default(now())` and `updatedAt @updatedAt`. Most have `deletedAt DateTime?` for soft delete. |
| Money | `Decimal @db.Decimal(12, 2)` — never `Float` or `Int` cents. Use `@/lib/money` utilities (`aud`, `gstFromInclusive`, `roundCents`) in code. |
| Foreign keys | Explicit `@relation(...)`. `onDelete: Restrict` by default; `Cascade` only when the parent owns the child's lifecycle (e.g. `BookingNote` cascades from `Booking`). |
| Indexes | `@@index([...])` on every FK and any field that's commonly filtered, sorted, or grouped. Compound indexes match the actual query order. |
| Enums | Live in `schema.prisma` itself — never split into a separate file. |
| Naming | Models PascalCase singular (`Booking`, `Vehicle`). Fields camelCase. Enum values SCREAMING_SNAKE_CASE. |

## Migration breaking-change checklist

Before letting a destructive migration land, flag to the user if `migration.sql` contains:

- `DROP COLUMN` on a column that's `@unique`, referenced by any `@relation`, or appears in `prisma/seed.ts`, `prisma/snapshots/`, or anywhere under `tests/`.
- `ALTER COLUMN ... NOT NULL` on a previously nullable column without a `DEFAULT` (will fail on existing rows).
- `DROP TABLE` on any model whose name appears anywhere in `src/`.
- Any change to a column referenced from a service in `src/server/services/` or a job in `src/server/jobs/`.

For breaking changes, propose a 2-step migration:
1. Add the new column / table.
2. Backfill in code (a `scripts/backfill-*.ts` helper) or via a SQL migration.
3. Follow up with a second migration that drops the old column.

The repo has many `scripts/backfill-*.ts` examples to model after.

## Seed and fixtures

- `prisma/seed.ts` — full demo seed; rerun with `npm run db:seed`.
- `prisma/snapshots/minimal.sql` — minimal-state snapshot used by `npm run db:reset` for fast local iteration.
- After a schema change that adds a required field with no default, update the seed and (if appropriate) regenerate the minimal snapshot.

## After every schema change

1. `npm run db:generate` (Prisma Client codegen).
2. `npm run typecheck` (PostToolUse `typecheck-changed.sh` will catch any consumer that referenced the old shape).
3. Add or update the matching unit test under `tests/unit/services/` if a service's query shape changed (mirror rule).
4. Summarise the blast radius (which services / jobs / routers / seed files were touched) in your reply.
