# Integrations

Integrations connect {{siteName}} to the outside services it relies on. Until
these are configured, the related features won't work — no payments, no SMS, no
ID checks. It's organised into tabs.

## The tabs

- **Overview** — connection status across all integrations at a glance.
- **Payments & ID** — the payment provider (card charges, bonds, refunds) and
  identity / licence verification services.
- **Messaging** — email and SMS delivery providers.
- **Accounting** — sync to your accounting package.
- **Tolls** — the eToLL feed that brings in toll charges (see **Infringements &
  tolls**).
- **Customer CX** — customer-experience tools (analytics, support).
- **Operations** — operational integrations and services.
- **API keys** — keys for programmatic access; treat them as secrets.

## Connecting a service

1. Open the relevant tab and enter the provider credentials / keys.
2. Use the connection test where available to confirm it's live.
3. Watch the **Overview** for a healthy status.

## Security

- API keys and provider secrets are sensitive. Rotate them if you suspect
  exposure, and remove keys that are no longer used.
- Payments are handled by the provider (PCI-DSS) — the system never touches raw
  card numbers. Don't attempt to capture card data outside the provider's flow.

## When something stops working

If payments fail, SMS doesn't arrive, or tolls stop importing, check the relevant
integration tab first — an expired key or a provider outage is the usual cause.
Delivery failures also show in the **Communications** log and the **Audit Log**
(webhooks & jobs).
