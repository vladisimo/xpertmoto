# src/lib/ — auth, branding, money, logger

This file is loaded when Claude reads or edits files in `src/lib/`. The root [CLAUDE.md](../../CLAUDE.md) covers stack-wide change management; this is the cross-cutting-concerns contract.

## Auth / NextAuth v5

The auth surface is split across three files:
- [auth.ts](auth.ts) — NextAuth config, providers, callbacks
- [auth-signin.ts](auth-signin.ts) — pure `evaluateSignIn()` gate (testable without a DB)
- [auth-step-up.ts](auth-step-up.ts) + [auth-step-up-token.ts](auth-step-up-token.ts) — TOTP step-up flow

### Provider rules
- OAuth providers: Google, Apple, Microsoft Entra ID (covers Hotmail/Outlook/Live/MSN), GitHub. Each provider only registers when its env vars are set — missing keys let local dev boot without every provider configured.
- Microsoft Entra ID does **not** need a separate "Hotmail" provider.
- Auto-link existing users on OAuth sign-in only when the provider verifies email ownership: Google/Apple use `email_verified`, Microsoft requires `xms_edov === true`, GitHub requires a primary-and-verified row from `/user/emails`.

### TOTP step-up flow
OAuth sign-in is allowed for every role by default — including back-office (STAFF / MANAGER / ADMIN / SUPER_ADMIN). Back-office users have TOTP enrolment enforced (the staff and admin layouts redirect to `/totp/enroll` on first sign-in), so OAuth never bypasses 2FA:

1. OAuth or magic-link callback lands on a TOTP-enrolled user.
2. The JWT callback flags `pending2fa: true`.
3. `requireFullSession` ([auth-step-up.ts:21](auth-step-up.ts)) routes them to `/verify-2fa-step-up` before any back-office route renders.
4. The `auth.verifyOauthStepUp` mutation clears the flag — sharing the lockout ladder and rate-limit buckets with the credentials login flow.
5. `protectedProcedure` treats `pending2fa` sessions as anonymous; only the dedicated `stepUpProcedure` accepts them.

The `auth.oauthAllowedForBackOffice` SystemSetting (default `true`) lets ops re-tighten policy without a code change. When `false`, `evaluateSignIn` rejects OAuth for non-CUSTOMER roles with `OAuthDisabledForBackOffice`, forcing back-office users back to email + password (which still enforces TOTP).

Step-up tokens are 60s one-shot HMAC-SHA256 handoffs. Pending-2FA TTL is 10 minutes (`PENDING_2FA_TTL_MS` in `auth-step-up-token.ts`).

## Branding (multi-tenant)

The dFortix.ai SaaS architecture is one-deployment-per-tenant. Each customer (XPERT Moto today, others tomorrow) configures their own branding via admin settings.

- Server: import [`getBranding`](branding.ts) from `@/lib/branding`. Reads from the `Organisation` SystemSetting row.
- Client: import `useBranding()` from `@/components/shared/branding-provider`. Layouts wrap children with `<BrandingProvider value={await getBranding()}>`.
- The `FALLBACK` literal in [`branding-provider.tsx`](../components/shared/branding-provider.tsx) (`siteName: "XPERT Moto"`) is **only** a typed placeholder for createContext. It is never the live answer in production.

Never hardcode "XPERT Moto", "Mercury Road Equipment", or any trading name / ABN in `src/`. Always read through the branding helpers. See the `project_saas_architecture.md` and `feedback_branding_provider_fallback.md` memory entries for the full rule.

## Money

[money.ts](money.ts) is the single source for AUD arithmetic:

- `aud(value)` — coerce to `Prisma.Decimal`
- `roundCents(value)` — round half-up to 2 dp
- `gstFromInclusive(total)` — GST = total / 11 (CLAUDE.md rule #4)
- `subtotalExGst(total)`, `sum(...values)`, `times(value, scalar)`, `divide(value, divisor)`, `applyPercentage(value, pct)`

Never inline `Math.round((amount / 11) * 100) / 100` anywhere in the codebase. See `feedback_gst_use_utility.md` memory for the full rule and known offenders.

## Logger

[logger.ts](logger.ts) is an HMR-safe pino singleton with built-in PII redaction. Always:

```ts
import { logger } from "@/lib/logger";
logger.info({ ... }, "human-readable summary");
```

**Never `console.*` from server code** — it bypasses redaction. Currently redacted paths (~30 fields) include passwords, tokens, cookies, licence numbers, DOB, addresses, Stripe IDs, card details, email, phone, IP, and visitor-analytics PII. If you log a new PII field that isn't in `redactPaths`, add it to the list — don't string-mask manually.

## Logging in jobs

[BullMQ jobs](../server/jobs/) hardcode `tz: "Australia/Brisbane"` for every cron repeat. This is implicit and not surfaced as configuration. Multi-depot tenants outside SE QLD will need this surfaced as env / org settings — flag if you're touching this area as part of a larger change. See `project_brisbane_tz_in_jobs.md` memory.

## Validators

`src/lib/validators/` houses Zod schemas reused across procedures, forms, and webhooks. Don't duplicate validators inline — search `src/lib/validators/` first.

## Storage

[storage.ts](storage.ts) abstracts S3-compatible blob storage (AWS S3 in prod, MinIO locally). Use it for any uploaded file (licence photos, vehicle images, signed agreements). Never write directly to local disk from server code.
