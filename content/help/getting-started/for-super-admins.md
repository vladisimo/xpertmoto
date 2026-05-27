# Getting started for super admins

Super Admin is the highest level of access. On top of everything an admin can
do, you own the platform itself and the global configuration that shapes the
whole deployment. With that comes responsibility — changes here affect every
user.

## Platform

**Administration → Platform** is your system console, with tabs for:

- **Database** — connection health and stats.
- **Server** — runtime and process information.
- **Storage** — object storage (file uploads: licences, photos, signed agreements).
- **LLM** — the AI provider powering insights and support assistance.
- **Email** and **SMS** — delivery provider health and test sends.
- **Payments** — the payment provider connection.
- **Observability** — logging and error monitoring.

Use it to confirm everything is connected and healthy, especially after a deploy
or a configuration change.

## System settings

**Administration → System Settings** holds the global configuration:

- **Branding** — trading name, legal name, ABN, logos and colours. Everything
  customer-facing reads from here, so this is how the product becomes
  "{{siteName}}" rather than a generic platform. Never hardcode these elsewhere.
- **Business rules** — defaults behind cancellation tiers, bond amounts, grace
  periods and the pricing cascade.
- **Feature flags and policy toggles** — e.g. whether OAuth is allowed for
  back-office sign-in.

## Backups

**Administration → Backups** shows data backups and restore points. Confirm
backups are running and know where your restore points are *before* you ever
need them.

## Operate with care

- Keep the number of Super Admins minimal — every one is a high-value target.
- Prefer changing behaviour through **System Settings** over code changes.
- The **Audit Log** records super-admin actions and impersonation; treat it as
  the source of truth in any investigation.
- Read the **Policies & concepts** guides so configuration changes don't quietly
  break pricing, bonds or refunds.
