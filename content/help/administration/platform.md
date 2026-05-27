# Platform

Platform is the super-admin system console — the health and configuration of the
infrastructure {{siteName}} runs on. It's read-mostly: a place to confirm
everything is connected and healthy, especially after a deploy or config change.

## The tabs

- **Database** — connection health and statistics for the primary datastore.
- **Server** — runtime and process information.
- **Storage** — object storage health (where uploaded files live: licence
  photos, vehicle images, signed agreements).
- **LLM** — the AI provider behind insights and support assistance.
- **Email** — email delivery provider status and test sends.
- **SMS** — SMS provider status and test sends.
- **Payments** — payment provider connection health.
- **Observability** — logging and error monitoring.

## How to use it

1. After any deploy or integration change, do a pass across the tabs to confirm
   green status.
2. If a feature is misbehaving (no emails, failed payments, missing uploads),
   start at the matching tab to see whether the underlying service is healthy.
3. Use test sends (Email / SMS) to verify delivery end-to-end without bothering a
   real customer.

## Boundaries

Platform shows infrastructure health and connectivity. The *business* settings —
branding, policies, feature flags — live in **System Settings**. Provider
*credentials* are entered under **Integrations**. Keep the three straight:
Platform = is it healthy, Integrations = is it connected, System Settings = how it
should behave.
