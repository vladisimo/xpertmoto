# Essential Eight Self-Assessment

**Attested entity:** Mercury Road Equipment Pty Ltd (ABN 36 614 422 187), as
publisher of the dFortix.ai scooter-hire platform.

**Scope of assessment:** the platform codebase in this repository, covering
public site, customer portal, staff back-office, administrator panel, tRPC
API, background workers and managed infrastructure dependencies.

**Assessment type:** self-assessment. This is not a third-party IRAP
assessment or Essential Eight Maturity Model audit. Self-assessment is
appropriate for the product's current customer base (Australian B2C
consumer hire). Third-party attestation will be engaged before the first
enterprise or government deployment.

**Assessed against:** ACSC Essential Eight Maturity Model, current
published revision as of 2026-04-21.

**Assessment date:** 2026-04-21 · **Next review due:** 2027-04-21.

**Overall position:** Maturity Level 2 across applicable controls, with
two declared known gaps (Control 4, Control 8).

---

## Control-by-control evidence

### Control 1 — Application control

**Maturity claim:** ML2 (cloud-interpreted)

**Rationale:** the ACSC control targets Windows executable allow-listing,
which does not map directly to a server-side cloud-native SaaS. We
interpret the control as "only signed, reviewed code runs in
production" and evidence it through:

- CI pipeline gate: `npm audit --audit-level=high` fails builds on any
  high-or-critical CVE in production dependencies. See
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).
- `package-lock.json` is committed; every production install uses
  `npm ci` against the lockfile; no floating version ranges are
  installed at build or deploy time.
- Deployment artefacts are built by CI, not by individual developers,
  and only the build artefact is promoted to production. Developers
  cannot deploy arbitrary code.

### Control 2 — Patch applications

**Maturity claim:** ML2

**Rationale:** automated dependency vulnerability scanning runs on every
CI build; vulnerable versions are caught before merge. High-severity
patches are deployed within 48 hours of a fixed release being
available; critical patches within 24 hours.

- CI `npm audit` integration per Control 1.
- Managed hosting provider (Vercel/AWS) patches underlying
  platform-as-a-service components automatically.
- Third-party SDK updates (Stripe, Twilio, Sentry, AWS SDK) tracked
  via Dependabot-equivalent tooling.

### Control 3 — Configure Microsoft Office macro settings

**Maturity claim:** Not applicable.

**Rationale:** no Microsoft Office or equivalent macro execution
environment exists in the production stack. There is no user-authored
script execution server-side. The control has no corresponding attack
surface.

### Control 4 — User application hardening

**Maturity claim:** ML1 — moving to ML2

**Rationale:** security response headers are enforced in
[`next.config.mjs`](../../next.config.mjs) on every response:

- HSTS with two-year max-age and `preload`.
- `X-Frame-Options: SAMEORIGIN`.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` denies camera, microphone and restricts
  geolocation.
- Content Security Policy with Stripe, Google, Sentry allow-listing.

**Known gap:** CSP is currently `Content-Security-Policy-Report-Only`
rather than enforcing. Violations are reported to an internal endpoint
and reviewed, but the browser is not yet blocking. Enforcement is
tracked in the internal security backlog and depends on finalising
allow-lists for all embedded third-party integrations.

### Control 5 — Restrict administrative privileges

**Maturity claim:** ML3

**Rationale:** five-role access control with hard enforcement at both
the route layer and the API layer:

- Roles: `CUSTOMER`, `STAFF`, `MANAGER`, `ADMIN`, `SUPER_ADMIN`.
  Defined in [`prisma/schema.prisma`](../../prisma/schema.prisma) as
  `UserRole` enum.
- tRPC procedure guards in
  [`src/server/trpc/trpc.ts`](../../src/server/trpc/trpc.ts): each
  privileged procedure declares its role requirement; guard is enforced
  server-side regardless of client state.
- Route-layer redirects via per-segment layouts in `(staff)` and
  `(admin)` route groups.
- Impersonation (admin viewing as another user) requires a signed HMAC
  token minted only by `SUPER_ADMIN`. Impersonation session carries an
  `impersonatorId` on every audit record.
- All privileged mutations are audit-logged with user id, impersonator
  id (if any), IP address, user agent, request id, before-value and
  after-value.
- Multi-factor authentication is required for all staff and
  administrator roles — see Control 7.

### Control 6 — Patch operating systems

**Maturity claim:** ML2

**Rationale:** operating system patching is delegated to the managed
hosting provider, which publishes a patching SLA covering the Node.js
runtime, the underlying Linux kernel, and base container images. Where
we run our own containers (background workers via Docker), the base
image is rebuilt against the latest upstream LTS release on a defined
cadence and redeployed automatically.

### Control 7 — Multi-factor authentication

**Maturity claim:** ML3 for staff, ML2 for customers

**Rationale:**

- Staff, managers, administrators and super-administrators must enrol
  TOTP before accessing any privileged route. Enrolment and
  verification logic in
  [`src/lib/auth.ts`](../../src/lib/auth.ts). Recovery codes are
  single-use and regenerated on demand.
- Customers may enrol TOTP optionally. All authentication (staff and
  customer) is protected by Redis-backed per-IP rate limiting and
  automatic account lockout after repeated failures (see
  [`src/lib/auth-lockout.ts`](../../src/lib/auth-lockout.ts)).
- Passwords are hashed with bcrypt (10 rounds); bumping to 12 rounds
  is in the backlog.
- OAuth sign-in (Google, Apple, Microsoft Entra ID, GitHub) verifies
  email ownership before linking — provider-specific claims checked
  in `evaluateSignIn`. Staff accounts cannot sign in via OAuth, only
  email + password + TOTP.

### Control 8 — Regular backups

**Maturity claim:** ML2

**Rationale:**

- Nightly encrypted `pg_dump` runs via
  [`src/server/jobs/db-backup.ts`](../../src/server/jobs/db-backup.ts),
  streamed directly to S3-compatible object storage with
  server-side encryption.
- 30-day retention window configurable via `SystemSetting` key
  `backup.retentionDays`. Lifecycle policy on the bucket deletes
  older objects.
- Backup status recorded in the `DatabaseBackup` table: status,
  size, storage key, schema version, error reason on failure.
- Failure alerting via `SystemSetting` key `backup.alertOnFailure`.
- Redis is configured with AOF persistence for queue durability
  across container restarts.

**Known gap:** a documented, scheduled restore drill is not yet in
place. Backups are taken and retained but the full
restore-from-backup procedure has not been exercised on a recurring
basis. Documented quarterly restore drill is tracked in the internal
security backlog.

---

## Cross-cutting controls (beyond Essential Eight)

These controls are not part of the Essential Eight framework but are
relevant to auditors evaluating our security posture.

- **Audit logging:** append-only audit log covers all privileged
  mutations, authentication events, payment operations and webhook
  receipts. Auto-middleware in
  [`src/server/trpc/trpc.ts`](../../src/server/trpc/trpc.ts).
  Sanitiser in
  [`src/server/services/audit-sanitize.ts`](../../src/server/services/audit-sanitize.ts)
  redacts 32 sensitive fields before persistence.
- **Structured logging:** Pino with 42 PII redaction paths in
  [`src/lib/logger.ts`](../../src/lib/logger.ts). JSON output to
  stdout for cloud ingestion in production.
- **Error monitoring:** Sentry on server, client and edge runtimes,
  all DSN-gated by environment.
- **Secret management:** Zod-validated environment variables in
  [`src/lib/env.ts`](../../src/lib/env.ts); production rejects
  known-dev placeholder values. Secret-rotation runbook at
  [`docs/ops/secret-rotation-runbook.md`](../ops/secret-rotation-runbook.md).
- **Webhook verification:** Stripe signatures verified on every
  inbound webhook; Twilio signatures verified via HMAC-SHA1. Both
  idempotent on retry.
- **Field-level encryption:** driver licence and passport numbers
  encrypted at the application layer with AES-256-GCM — see
  [`src/lib/crypto.ts`](../../src/lib/crypto.ts) and
  [`src/lib/customer-pii.ts`](../../src/lib/customer-pii.ts).
- **Payment boundary:** tokenisation-only model. Raw PAN, CVV and
  full-magnetic-stripe data never reach our servers; only opaque
  Stripe identifiers are stored.

---

## Known gaps — summary backlog

| Gap | Control | Target | Status |
|---|---|---|---|
| Enforce Content Security Policy (move from report-only) | 4 | Q3 2026 | On backlog |
| Document and execute quarterly restore drill | 8 | Q3 2026 | On backlog |
| Bump bcrypt rounds from 10 to 12 | 7 | Next maintenance window | On backlog |
| Add failed-login burst detector | (beyond E8) | Q3 2026 | On backlog |

---

## Review history

| Date | Reviewer | Summary |
|---|---|---|
| 2026-04-21 | Platform security owner | Initial self-assessment baseline. |

Next scheduled review: 2027-04-21 or immediately following any material
change to authentication, authorisation, encryption or backup systems.
