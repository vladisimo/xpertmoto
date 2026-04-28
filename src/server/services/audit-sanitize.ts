/**
 * Sanitize values before they land in AuditLog.previousData / newData.
 *
 * Redacts the same PII keys as the pino logger (src/lib/logger.ts), plus
 * soft-redacts email / phone to keep forensically useful prefixes/suffixes.
 * Caps serialized size so oversized payloads don't bloat the audit table.
 */

const HARD_REDACT_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "token",
  "authorization",
  "cookie",
  "licenceNumber",
  "licenceImageFront",
  "licenceImageBack",
  "passportNumber",
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
  "secret",
  "apiKey",
  "totpCode",
  "refreshToken",
  "accessToken",
  "recoveryCode",
  "recoveryCodes",
]);

const SOFT_REDACT_KEYS = new Set(["email", "phone"]);

const MAX_BYTES = 8192;
const MAX_DEPTH = 6;

function softRedactEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return "[REDACTED]";
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const head = local.slice(0, 1);
  return `${head}***${domain}`;
}

function softRedactPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "[REDACTED]";
  return `***${digits.slice(-4)}`;
}

function walk(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[MAX_DEPTH]";
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (HARD_REDACT_KEYS.has(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      if (SOFT_REDACT_KEYS.has(key) && typeof val === "string") {
        out[key] = key === "email" ? softRedactEmail(val) : softRedactPhone(val);
        continue;
      }
      out[key] = walk(val, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitize(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const cleaned = walk(value, 0);
  let json: string;
  try {
    json = JSON.stringify(cleaned);
  } catch {
    return { __unserializable: true };
  }
  if (json.length <= MAX_BYTES) return cleaned;
  return {
    __truncated: true,
    size: json.length,
    preview: json.slice(0, MAX_BYTES - 64) + "...[TRUNCATED]",
  };
}
