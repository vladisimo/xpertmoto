import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Sentry PII scrubber — the observability-side mirror of the pino redaction
 * list in `src/lib/logger.ts`. The logger only protects log output; events
 * sent to Sentry (exception extras, breadcrumbs, request bodies, contexts)
 * bypass it entirely, so without this an APP-protected field could leave the
 * app inside an error report. Wire it as `beforeSend` on every `Sentry.init`.
 *
 * Runtime-neutral by design: this loads in the Node, Edge, and browser
 * runtimes, so it must stay free of node-only imports (no pino, no fs).
 *
 * Strategy: deep-walk the event and replace any value whose KEY matches the
 * sensitive set — never matching on values, so benign fields keep their data.
 * `event.user` is deliberately left intact: the tRPC middleware (trpc.ts) and
 * SentryIdentify set a stable id (+ email server-side) there on purpose for
 * triage, and that is the one controlled place PII is allowed.
 */

// Lower-cased field names mirroring logger.ts redactPaths. Kept as a plain
// set (not the pino glob format) because we match on object keys directly.
const SENSITIVE_KEYS = new Set(
  [
    "password",
    "token",
    "authorization",
    "cookie",
    "licenceNumber",
    "licenceImageFront",
    "licenceImageBack",
    "passportNumber",
    "dateOfBirth",
    "emergencyContactName",
    "emergencyContactPhone",
    "address",
    "addressLine1",
    "addressLine2",
    "suburb",
    "postcode",
    "stripePaymentIntentId",
    "stripeChargeId",
    "stripeCustomerId",
    "stripePaymentMethodId",
    "stripeSetupIntentId",
    "pan",
    "cardNumber",
    "cvv",
    "cvc",
    "cardholderName",
    // `email` is safe to scrub globally here because `event.user` is detached
    // before the walk — the controlled identity keeps its email, every other
    // occurrence (extra, breadcrumbs, request data) is redacted.
    "email",
    "phone",
    "ipHash",
    "ipAddress",
    "country",
    "region",
    "city",
    "referrer",
    "utmSource",
    "utmMedium",
    "utmCampaign",
  ].map((k) => k.toLowerCase()),
);

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;

function scrubDeep(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = scrubDeep(value[i], seen, depth + 1);
    }
    return value;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      obj[key] = REDACTED;
    } else {
      obj[key] = scrubDeep(obj[key], seen, depth + 1);
    }
  }
  return obj;
}

/**
 * `beforeSend` hook. Mutates and returns the event with sensitive fields
 * redacted everywhere except the controlled `event.user` identity.
 */
export function scrubSentryEvent(
  event: ErrorEvent,
  _hint?: EventHint,
): ErrorEvent {
  const seen = new WeakSet<object>();
  const preservedUser = event.user;
  // Temporarily detach user so the deep walk can't redact its email/id.
  event.user = undefined;
  scrubDeep(event, seen, 0);
  event.user = preservedUser;
  return event;
}
