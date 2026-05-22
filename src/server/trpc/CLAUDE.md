# src/server/trpc/ — procedures, money, audit, tests

This file is loaded when Claude reads or edits files in `src/server/trpc/`. The root [CLAUDE.md](../../../CLAUDE.md) covers stack-wide change management; this is the API-layer contract.

For a step-by-step walkthrough of adding a procedure, run the `trpc-procedure` skill at [.claude/skills/trpc-procedure.md](../../../.claude/skills/trpc-procedure.md).

## Scope vs spec

The original CLAUDE.md spec listed 14 routers. The actual repo has **44 routers** under [router/](router/), spanning bookings, fleet, customers, payments, maintenance, incidents, gift cards, referrals, loyalty, subscriptions, eToLL integration, yield pricing, telematics revenue, support AI, analytics, and backups. The procedure layer is the largest API surface in the codebase.

## Procedure layers — pick the right base

Six procedure bases are defined in [trpc.ts:225-353](trpc.ts). Picking the wrong one silently breaks auth.

| Caller | Base | Notes |
|---|---|---|
| Anonymous endpoints | `publicProcedure` | Login, public booking lookup, marketing pages |
| Any authenticated user | `protectedProcedure` | Default for customer-portal endpoints. Blocks `pending2fa` (UNAUTHORIZED) and `requiresOnboarding` (FORBIDDEN). |
| STAFF / MANAGER / ADMIN / SUPER_ADMIN | `staffProcedure` | Pre-baked `requireRole`. Inherits `protectedProcedure`'s gates. |
| MANAGER / ADMIN / SUPER_ADMIN | `managerProcedure` | |
| ADMIN / SUPER_ADMIN | `adminProcedure` | |
| SUPER_ADMIN only | `superAdminProcedure` | Destructive ops, billing config, impersonation. |
| TOTP step-up flow only | `stepUpProcedure` | **Hard rule:** only `auth.verifyOauthStepUp` may use it. Accepts `pending2fa` sessions. |
| Customer onboarding wizard only | `onboardingProcedure` | **Hard rule:** only used inside the `onboarding` router. Accepts `requiresOnboarding` sessions, CUSTOMER role only. |

Don't inline `if (ctx.session.user.role !== ...)` checks after `protectedProcedure` — use `requireRole([...])` so the gate is visible at the import site.

## Money — always via `@/lib/money`

Money arithmetic flows end-to-end through `Prisma.Decimal` to avoid IEEE-754 artefacts. Import from [`@/lib/money`](../../lib/money.ts):

| Helper | Purpose |
|---|---|
| `aud(value)` | Coerce anything number-ish to `Prisma.Decimal`. |
| `roundCents(value)` | Round half-up to 2 dp. |
| `gstFromInclusive(total)` | GST = total / 11 (CLAUDE.md rule #4). |
| `subtotalExGst(total)` | Total minus GST, rounded. |
| `sum(...values)`, `times(value, scalar)`, `divide(value, divisor)`, `applyPercentage(value, pct)` | Composable arithmetic. |

**Never inline `Math.round((amount / 11) * 100) / 100`** for GST. Three known offenders (`gift-card.ts`, `telematics-revenue.ts`, `return.ts`) are tech debt being cleaned up. Don't add a fourth.

Only call `.toNumber()` after a `.round(2)` (or via `roundCents`) at the final presentation / DB-write step.

## Audit log for mutations

Any mutation that changes user-visible state writes to the audit log via [`@/server/services/audit`](../services/audit.ts):

```ts
return ctx.db.$transaction(async (tx) => {
  const result = await tx.<entity>.update({ ... });
  await audit.log(ctx, {
    category: "<DOMAIN>",
    action: "<entity>.<verb>",
    entity: "<EntityName>",
    entityId: result.id,
    previousData: { ... },
    newData: { ... },
  });
  return result;
});
```

Skip audit for: pure queries, in-flight optimistic state, internal job-driven updates that already log via the job runner.

## Testing contract (mirror rule)

`src/server/trpc/router/X.ts` → `tests/unit/trpc/router/X.test.ts`. The PostToolUse [`test-affected.sh`](../../../.claude/hooks/post/test-affected.sh) hook runs the matching test on every edit.

Minimum coverage for a new procedure:
- One happy-path case
- One auth-failure case (e.g. calling a `protectedProcedure` without a session)
- One Zod-validation case for any non-trivial input

Use `<router>.createCaller(mockCtx)`. Worked example: [tests/unit/trpc/router/vehicle.test.ts](../../../tests/unit/trpc/router/vehicle.test.ts).

Many existing routers don't yet have a unit test — coverage backfill is part of in-flight Phase 6 polish. New code is expected to ship with a matching test; existing routers without one are a known gap, not an invitation to skip.

## Input validation

- Zod schemas co-located with the procedure, exported as `<Name>Input` so the front-end can re-use the inferred type via `inferProcedureInput`.
- `z.string().email()` / `.uuid()` / `.cuid()` for IDs from external sources.
- Any monetary input goes through `aud()` before hitting the DB.

## Pagination

Cursor-based for any list endpoint that can grow unbounded. Helpers and patterns live in [router/_pagination.ts](router/_pagination.ts) where present. Default page size 20–50; cap at 100.
