/**
 * Central registry of every admin-editable integration field. Keeps the
 * DB key, env fallback, label and secret/public metadata in one place so
 * both the lib loaders and the admin UI stay in sync.
 */
export type IntegrationField = {
  key: string;
  envFallback?: string;
  label: string;
  helperText?: string;
  secret: boolean;
  /** If true, value is exposed to the browser (public keys). */
  publiclyExposable?: boolean;
};

export type IntegrationService = {
  id: string;
  name: string;
  fields: IntegrationField[];
};

export const INTEGRATION_SERVICES: IntegrationService[] = [
  {
    id: "stripe",
    name: "Stripe",
    fields: [
      { key: "integration:stripe:secretKey", envFallback: "STRIPE_SECRET_KEY", label: "Secret key", secret: true, helperText: "sk_live_… or sk_test_…" },
      { key: "integration:stripe:publishableKey", envFallback: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", label: "Publishable key", secret: false, publiclyExposable: true, helperText: "pk_live_… or pk_test_…" },
      { key: "integration:stripe:webhookSecret", envFallback: "STRIPE_WEBHOOK_SECRET", label: "Webhook signing secret", secret: true, helperText: "whsec_… (from Stripe Dashboard → Developers → Webhooks)" },
    ],
  },
  {
    id: "twilio",
    name: "Twilio SMS",
    fields: [
      { key: "integration:twilio:accountSid", envFallback: "TWILIO_ACCOUNT_SID", label: "Account SID", secret: false },
      { key: "integration:twilio:authToken", envFallback: "TWILIO_AUTH_TOKEN", label: "Auth token", secret: true },
      { key: "integration:twilio:fromNumber", envFallback: "TWILIO_FROM_NUMBER", label: "From number", secret: false, helperText: "+61412345678" },
      { key: "integration:app:publicUrl", envFallback: "NEXT_PUBLIC_APP_URL", label: "Public app URL (for StatusCallback)", secret: false, helperText: "https://app.xpertmoto.com.au" },
    ],
  },
  {
    id: "resend",
    name: "Resend email",
    fields: [
      { key: "integration:resend:apiKey", envFallback: "RESEND_API_KEY", label: "API key", secret: true, helperText: "re_…" },
      { key: "integration:resend:webhookSecret", envFallback: "RESEND_WEBHOOK_SECRET", label: "Webhook signing secret", secret: true, helperText: "whsec_…" },
      { key: "integration:resend:from", envFallback: "EMAIL_FROM", label: "From address", secret: false, helperText: "no-reply@xpertmoto.com.au" },
    ],
  },
  {
    id: "xero",
    name: "Xero",
    fields: [
      { key: "integration:xero:clientId", envFallback: "XERO_CLIENT_ID", label: "Client ID", secret: false },
      { key: "integration:xero:clientSecret", envFallback: "XERO_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
  },
  {
    id: "push",
    name: "Web push (VAPID)",
    fields: [
      { key: "integration:vapid:publicKey", envFallback: "VAPID_PUBLIC_KEY", label: "VAPID public key", secret: false, publiclyExposable: true },
      { key: "integration:vapid:privateKey", envFallback: "VAPID_PRIVATE_KEY", label: "VAPID private key", secret: true },
      { key: "integration:vapid:contact", envFallback: "VAPID_CONTACT", label: "Contact email", secret: false, helperText: "ops@xpertmoto.com.au" },
    ],
  },
  {
    id: "posthog",
    name: "PostHog analytics",
    fields: [
      { key: "integration:posthog:serverKey", envFallback: "POSTHOG_KEY", label: "Server project key", secret: true, helperText: "phc_…" },
      { key: "integration:posthog:browserKey", envFallback: "NEXT_PUBLIC_POSTHOG_KEY", label: "Browser project key", secret: false, publiclyExposable: true, helperText: "phc_… (safe to ship to client)" },
      { key: "integration:posthog:host", envFallback: "POSTHOG_HOST", label: "Host", secret: false, helperText: "https://us.i.posthog.com" },
    ],
  },
  {
    id: "telemetry",
    name: "GPS telemetry ingest",
    fields: [
      { key: "integration:telemetry:ingestToken", envFallback: "TELEMETRY_INGEST_TOKEN", label: "Ingest bearer token", secret: true },
    ],
  },
];

export function findField(key: string): IntegrationField | undefined {
  for (const svc of INTEGRATION_SERVICES) {
    const f = svc.fields.find((f) => f.key === key);
    if (f) return f;
  }
  return undefined;
}

export function flattenFields(): IntegrationField[] {
  return INTEGRATION_SERVICES.flatMap((s) => s.fields);
}
