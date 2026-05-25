# Webhooks

Webhooks are the inbound messages other services send {{siteName}} when
something happens on their side — Stripe telling us a payment succeeded, Twilio
reporting an SMS was delivered, and so on. This area lets you inspect those
events and replay them when needed.

## What you can do

- **Inspect** received webhook events, with their payload and processing result.
- **See failures** — events that arrived but didn't process cleanly.
- **Replay** an event to re-trigger processing after you've fixed the cause.

## When you'd use it

- A payment succeeded at the provider but the booking didn't update → find the
  event and replay it.
- An SMS delivery status never reflected → check whether the webhook arrived.
- Diagnosing an integration: the webhook history shows whether the provider is
  actually calling us.

## How it relates to other areas

- Webhook activity also appears in the **Audit Log** under *Webhooks & Jobs*.
- The services that send these webhooks are configured under **Integrations**.
- Most webhooks drive money or messaging, so a backlog here often explains a
  finance or communications discrepancy.

## Care with replays

Replaying an event re-runs its processing. That's safe by design (handlers are
built to be idempotent), but replay deliberately and one at a time when
investigating, rather than en masse.
