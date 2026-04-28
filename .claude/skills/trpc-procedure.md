---
name: trpc-procedure
description: Use this skill when adding or modifying a tRPC procedure in src/server/trpc/router/*.ts. Enforces the procedure-base choice (publicProcedure vs protectedProcedure vs staffProcedure vs stepUpProcedure vs onboardingProcedure), Zod input shape, audit log requirement for mutations, and the matching unit test (mirror rule). Triggers on phrases like "add a tRPC procedure", "new mutation", "new query", "expose this from the API", "router endpoint".
---

# tRPC procedure scaffold

You are about to add or modify a tRPC procedure in `src/server/trpc/router/`.
This repo has six procedure bases with non-obvious gating — picking the wrong
one silently breaks auth.

## 1. Pick the right base

| Caller | Base |
|---|---|
| Anonymous endpoints (login, public booking lookup, marketing site) | `publicProcedure` |
| Any authenticated user (CUSTOMER, STAFF, MANAGER, ADMIN, SUPER_ADMIN) | `protectedProcedure` |
| Back-office (STAFF and above) | `staffProcedure` |
| Manager and above | `managerProcedure` |
| Admin and above | `adminProcedure` |
| SUPER_ADMIN only (destructive ops, billing config, impersonation) | `superAdminProcedure` |
| **TOTP step-up flow only** | `stepUpProcedure` |
| **Customer onboarding wizard only** | `onboardingProcedure` |

Defaults: queries → `publicProcedure` if truly public, else `protectedProcedure`.
Mutations → match the smallest role that needs to call it.

**Hard rule:** never use `stepUpProcedure` outside the single `auth.verifyOauthStepUp`
mutation. Never use `onboardingProcedure` outside the `onboarding` router. These
gates exist to prevent half-authenticated sessions from reaching the rest of
the API. See [src/server/trpc/trpc.ts:225-353](../../src/server/trpc/trpc.ts) for
the canonical implementations.

## 2. Input schema — Zod, co-located, exported

```ts
import { z } from "zod";

export const createGiftCardInput = z.object({
  amount: z.number().positive(),
  recipientEmail: z.string().email(),
  message: z.string().max(500).optional(),
});
export type CreateGiftCardInput = z.infer<typeof createGiftCardInput>;
```

Reasons:
- Exported so the front-end can re-use the inferred type via `inferProcedureInput`.
- `z.string().email()` / `.uuid()` / `.cuid()` for IDs from external sources.
- Use `Prisma.Decimal` via `aud()` (`@/lib/money`) when the value is money.

## 3. Money arithmetic

If the procedure touches money, **import from `@/lib/money`**:

- `aud(value)` → coerce to `Prisma.Decimal`
- `roundCents(value)` → round half-up to 2 dp
- `gstFromInclusive(total)` → GST = total / 11
- `subtotalExGst(total)` → total minus GST
- `sum(...values)`, `times(value, scalar)`, `applyPercentage(value, pct)`

Never inline `Math.round((amount / 11) * 100) / 100` for GST. There are 3
known offenders (`gift-card.ts`, `telematics-revenue.ts`, `return.ts`) that
are being cleaned up — don't add a fourth.

## 4. Audit log for mutations

Any mutation that changes user-visible state writes to the audit log:

```ts
import { audit } from "@/server/services/audit";

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

Skip audit for: pure queries, in-flight optimistic state, internal job-driven
updates that already log via the job runner.

## 5. Matching unit test (mirror rule)

For `src/server/trpc/router/<router>.ts`, add or extend
`tests/unit/trpc/router/<router>.test.ts`. At minimum:

- One happy-path case
- One auth-failure case (e.g. `expect(...).rejects.toThrow(/UNAUTHORIZED/)`
  for a `protectedProcedure` called without a session)
- One Zod-validation case for any non-trivial input shape

Use `<router>.createCaller(mockCtx)` — see `tests/unit/trpc/router/vehicle.test.ts`
for a worked example. Avoid hitting a real DB in unit tests; mock `ctx.db` with
`vi.fn()` returning fixed shapes.

## 6. Confirm

After the change:
- The PostToolUse `test-affected.sh` hook will run the matching test if it
  exists.
- The PostToolUse `typecheck-changed.sh` hook will catch any consumer that
  used the previous shape.
- Run `npm run lint` if the change spans more than two files.