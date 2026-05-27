# Integrations

Integrations connect {{siteName}} to the outside services it relies on. Until
these are configured, the related features won't work — no payments, no SMS, no
ID checks.

> **Credentials are configured via environment variables, not in the app.**
> There is no longer an in-app editor for provider secrets — Stripe, Twilio,
> Resend, Xero, web-push (VAPID), PostHog and the GPS telemetry token are all
> read from the deployment's environment (`.env` / hosting secrets). This page
> is a read-only status dashboard plus the few actions that genuinely live in
> the database (Xero connect, toll accounts, API keys).

## The tabs

- **Overview** — connection status across all integrations at a glance.
- **Payments & ID** — status of the payment provider (card charges, bonds,
  refunds) and identity / licence verification.
- **Messaging** — status of the email and SMS delivery providers.
- **Accounting** — Xero status, plus the **Connect** / **Disconnect** buttons
  for the Xero OAuth link (the OAuth tokens live in the database; the client ID
  and secret come from the environment).
- **Tolls** — the eToLL feed that brings in toll charges, and management of toll
  accounts (see **Infringements & tolls**).
- **Customer CX** — status of customer-experience tools (analytics, web push).
- **Operations** — status of operational integrations (GPS telemetry, PostHog).
- **API keys** — keys for programmatic access; treat them as secrets.

## Configuring a service

1. Set the service's environment variables in your deployment (each tab lists
   the variables it expects), then restart the app.
2. Watch the **Overview** for a healthy status.
3. For Xero, also click **Connect** on the Accounting tab to complete the OAuth
   link once the client ID/secret are in the environment.

## Security

- Provider secrets live in the environment, never the database — rotate them at
  the host / secrets store, then restart. See the secret-rotation runbook.
- API keys created on the **API keys** tab are hashed at rest. Rotate them if you
  suspect exposure, and revoke keys that are no longer used.
- Payments are handled by the provider (PCI-DSS) — the system never touches raw
  card numbers. Don't attempt to capture card data outside the provider's flow.

## When something stops working

If payments fail, SMS doesn't arrive, or tolls stop importing, check the relevant
integration tab first — a missing or expired environment variable, or a provider
outage, is the usual cause. Delivery failures also show in the **Communications**
log and the **Audit Log** (webhooks & jobs).
