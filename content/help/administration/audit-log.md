# Audit log

The Audit Log is the complete, tamper-evident record of what happens in the back
office — who did what, when, and what changed. It's your compliance and security
source of truth, organised into tabs.

## The tabs

- **Overview** — recent activity across all categories.
- **Security** — security-relevant events (lockouts, permission changes,
  suspicious activity).
- **Authentication** — sign-ins, 2FA events, failures.
- **Mutations** — changes to records (who edited a booking, a price, a user).
- **Webhooks & Jobs** — inbound webhooks (Stripe, Twilio…) and background job
  runs, including failures.
- **Impersonation** — any time a super admin acted as another user.
- **Activity** — general user activity.
- **All events** — the unfiltered stream.

## How to use it

- **Investigating a change:** "who changed this price / refunded this booking?"
  → **Mutations**, filtered to the entity.
- **A security concern:** unexpected sign-ins or lockouts → **Authentication**
  and **Security**.
- **A failed automation:** a reminder didn't send, a webhook didn't land →
  **Webhooks & Jobs**.

## Why it exists

Every mutation that changes user-visible state writes an audit entry with the
before/after data. That makes it possible to reconstruct exactly what happened in
a dispute, an incident, or a compliance review. Because actions are attributed to
individuals, **never share accounts** — it breaks the trail.

## Privacy note

The system redacts personal information (licence numbers, dates of birth,
addresses, card details) from logs by design. The audit log records *that* a
field changed without exposing sensitive values in plain text.
