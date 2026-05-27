# XPERT Moto — Claude Code project context

This file is loaded into every Claude Code turn in this repo. It is the
top-level contract; topic-specific rules live in **per-folder CLAUDE.md** files
that load on demand:

| Folder | Owns rules for |
|---|---|
| [prisma/CLAUDE.md](prisma/CLAUDE.md) | Schema, migrations, seed, breaking-change checklist |
| [src/server/trpc/CLAUDE.md](src/server/trpc/CLAUDE.md) | Procedure layers, money, audit log, test mirror rule |
| [src/components/ui/CLAUDE.md](src/components/ui/CLAUDE.md) | UI/UX Contract — layout primitives, tokens, buttons, role-distinct shells |
| [src/lib/CLAUDE.md](src/lib/CLAUDE.md) | Auth/TOTP, branding, money, logger, jobs |

When adding a new rule, edit the most specific folder's CLAUDE.md. Top-level
rules that span the whole repo (stack, change management, AU compliance) stay
here.

---

## Product

A production-ready, full-stack scooter and motorbike hire platform for the
Australian market. Trading as **XPERT Moto** (one of several deployments on
the dFortix.ai single-tenant-per-deployment SaaS). The system covers public
booking, customer portal, staff back-office, fleet/plant management, and
admin configuration. The original Phase 1–5 build prompt is largely
complete; **Phase 6 (Polish) is in flight** — error handling, Sentry, PDF,
SMS, BullMQ jobs, and CI are wired up; per-router unit-test coverage is the
biggest remaining gap.

The actual codebase has expanded well beyond the original spec — 117 Prisma
models, 44 tRPC routers, ~90 service modules, 27 React Email templates. See
the `project_codebase_scope` memory for context.

**Locale:** en-AU. **Currency:** AUD (GST-inclusive at 10%, divide-by-11).
**Compliance:** Australian Consumer Law, Australian Privacy Principles
(APPs), PCI-DSS via Stripe.

---

## Authoritative tech stack (May 2026)

The dependency list in [package.json](package.json) is the source of truth.
Additions or swaps require explicit user approval. The PreToolUse hook
[`.claude/hooks/pre/guard-package-json.sh`](.claude/hooks/pre/guard-package-json.sh)
surfaces every dep change in the transcript so the conversation has a paper
trail.

Next.js 16 · React 19 · TypeScript · Tailwind 3 + shadcn/ui (Radix) · tRPC
v11 + TanStack Query v5 · Zustand · NextAuth v5 · Prisma 5 · Stripe ·
react-hook-form + Zod · MapLibre GL JS · Sentry · Pino · Vitest + MSW ·
Playwright · FullCalendar · @dnd-kit · BullMQ + ioredis · React Email +
Resend · Twilio · @anthropic-ai/sdk · @react-pdf/renderer.

If your task appears to need something outside this list, stop and ask.

**Known drift:** `openai` v6.x is in deps for two specific services
(`document-extract.ts`, `support-ai.ts`). Not in the approved stack list;
flagged for migration discussion. Don't extend its surface to new files.
See `project_openai_sdk_drift` memory.

---

## Change management for Claude Code sessions

This section governs every Claude Code session in this repo. The
`.claude/hooks/` system enforces parts of it automatically — see
[.claude/hooks/README.md](.claude/hooks/README.md) for the full hook
inventory.

### 1. Scope discipline
- Work only within the scope the user has asked for. If a requested change
  genuinely straddles areas, flag it and ask before proceeding.
- "Drive-by" refactors are out of scope. Fix the bug / add the feature;
  don't rewrite adjacent code that happens to catch your eye. If you spot
  cleanup that belongs in its own change, note it to the user — don't do it.

### 2. Schema and migration discipline
- Any edit to [prisma/schema.prisma](prisma/schema.prisma) must ship with a
  corresponding migration in the same change.
- The PreToolUse hook
  [`.claude/hooks/pre/protect-schema.sh`](.claude/hooks/pre/protect-schema.sh)
  blocks schema edits unless the user turn mentions "migration" or
  "schema change" — be explicit.
- Never use `prisma db push` against a shared DB. The `guard-bash.sh` hook
  blocks it against any non-localhost DATABASE_URL.
- Detail rules + breaking-change checklist: [prisma/CLAUDE.md](prisma/CLAUDE.md).
  Step-by-step walkthrough: the `prisma-migration` skill.

### 3. Testing contract
- Mirror rule: `src/X/Y.ts` → `tests/unit/X/Y.test.ts`. The PostToolUse
  [`test-affected.sh`](.claude/hooks/post/test-affected.sh) hook runs the
  matching test on every edit.
- Every new tRPC procedure ships with at least one Vitest test covering the
  happy path and one failure case.
- Every new UI mutation that changes user-visible state gets an
  optimistic-UI smoke covered by a Playwright spec.
- `npm run typecheck` and `npm run lint` must be green before any change is
  considered done. The Stop hook
  [`definition-of-done.sh`](.claude/hooks/stop/definition-of-done.sh) blocks
  Stop on a red state.
- Many existing routers don't yet have a unit test — coverage backfill is
  in flight (see `reference_test_layout` memory).

### 4. Australian compliance — always on
- GST-inclusive pricing at 10% (divide-by-11). Use `gstFromInclusive()` from
  [src/lib/money.ts](src/lib/money.ts) — never inline `/ 11`.
- ABN on every invoice. Trading and legal name come from `getBranding()` —
  never hardcoded.
- Australian Privacy Principles for PII (licence, DOB, address, emergency
  contact). Redaction for these fields is built into the pino logger at
  [src/lib/logger.ts](src/lib/logger.ts) — do not log any of them through
  `console.*`.
- PCI-DSS via Stripe — never handle raw PAN.

### 5. Hooks (blocking vs feedback)
The hooks under [.claude/hooks/](.claude/hooks/) fall into two buckets:
- **Blocking** (PreToolUse, exit 2): `protect-schema.sh`, `guard-middleware.sh`,
  `guard-bash.sh` (for dangerous commands), and the Stop hook
  `definition-of-done.sh`. Must be unblocked explicitly in the user turn or
  via `CLAUDE_SKIP_HOOKS=<name>`.
- **Feedback-only** (warn via stderr, exit 0 or 1): everything else. These
  are your fast-feedback loop. When a PostToolUse hook reports a failure,
  fix it before marking the todo complete — don't move on.

Disable a hook only for a specific debugging session via
`CLAUDE_SKIP_HOOKS=<name>` — never commit hook removals.

---

## Critical business rules

These constants govern every booking-flow change. The full schema-level rules
live in the per-folder CLAUDE.md files; the rules below are the ones a fresh
session should never miss.

1. **GST**: All displayed prices are GST-inclusive. GST = total / 11.
   Always via `gstFromInclusive()`. Store both amounts. ABN on every invoice.
2. **Pricing cascade**: Category base rate → Duration discount → Seasonal
   multiplier → Depot-specific override → Discount code. Round to nearest
   cent. Snapshot final pricing in the booking record.
3. **Bond**: Held as a Stripe PaymentIntent authorisation (not captured).
   Auto-released after 14 days post-return (configurable) if no damage.
4. **Cancellation policy** (configurable in system settings):
   - >72hr before pickup: full refund minus $25 admin fee
   - 24–72hr: 50% refund
   - <24hr: no refund
   - No-show: no refund + $50 no-show fee
5. **Late returns**: 1-hour grace period. Then hourly rate = daily rate / 8
   (capped at daily rate per day). OVERDUE auto-status via 15-minute job.
6. **Availability**: AVAILABLE status + no overlapping CONFIRMED/ACTIVE
   booking + no overlapping maintenance + 2-hour cleaning buffer between
   bookings.
7. **Vehicle allocation**: at check-out, not booking time, unless
   pre-allocated by staff.
8. **Licence verification**: customer uploads licence photos; staff verify
   before check-out (manual checkbox + verifiedBy + timestamp). Expired
   licences are flagged.

---

## Project structure (quick reference)

```
scootering/
├── prisma/                  # Schema (117 models), 68 migrations, seed
├── src/
│   ├── app/                 # Next.js App Router (route groups by audience)
│   │   ├── (public)/        # Marketing + booking wizard
│   │   ├── (auth)/          # Login, register, magic-link
│   │   ├── (customer)/      # Authenticated customer portal
│   │   ├── (staff)/         # Back-office (BackOfficeShell accent="staff")
│   │   ├── (admin)/         # Admin (BackOfficeShell accent="admin")
│   │   ├── (onboarding)/    # TOTP enrolment, vehicle-owner signup
│   │   └── api/             # tRPC, webhooks (stripe/twilio), cron, health
│   ├── server/
│   │   ├── trpc/router/     # 44 tRPC routers — see src/server/trpc/CLAUDE.md
│   │   ├── services/        # ~90 business-logic modules
│   │   └── jobs/            # BullMQ workers (Australia/Brisbane TZ — gotcha)
│   ├── lib/                 # Auth, branding, money, logger — see src/lib/CLAUDE.md
│   ├── components/
│   │   ├── ui/              # shadcn primitives + StatusBadge — see src/components/ui/CLAUDE.md
│   │   ├── layout/          # PageShell, PageHeader, PageSection, BackOfficeShell
│   │   ├── forms/           # FormGrid, FormGridRow
│   │   └── <domain>/        # booking, customer, staff, admin, fleet, etc.
│   └── stores/              # Zustand — sparse usage
├── emails/                  # 27 React Email templates
├── tests/
│   ├── unit/                # Vitest, mirrors src/
│   ├── integration/         # Vitest with DB
│   └── e2e/                 # Playwright (auth/booking/payments/staff/admin/security)
├── scripts/                 # Backfills, data fixes, lint-status-badges.sh
├── docker/                  # Docker config
├── data/                    # Driver/vehicle import staging (gitignored)
└── .claude/                 # Hooks, skills, settings — see .claude/hooks/README.md
```

---

## Implementation requirements

1. **Type safety**: 100% TypeScript, strict mode, no `any`. Zod for all
   external input; types inferred from Prisma where possible.
2. **Error handling**: global error boundary, toast notifications for user
   actions, structured error responses from API, Sentry for unhandled errors.
3. **Performance**: cursor-based pagination on all list endpoints, Redis
   caching for availability/pricing, optimistic UI for status changes,
   `next/image` for images, lazy load heavy components (calendar, maps,
   PDF), DB indexes on FKs and common filters.
4. **Accessibility**: WCAG 2.1 AA. Semantic HTML, ARIA, keyboard nav, focus
   management.
5. **Responsive**: mobile-first; staff portal must work on tablet (primary
   inspection device).
6. **i18n-ready**: user-facing strings via constants/locale files
   (English-only today).
7. **Docker**: docker-compose with Next.js, Postgres 16, Redis 7, MinIO
   (S3), Mailpit (email testing).
