import { randomInt } from "node:crypto";

// Human-readable record ID helpers. Every generator here is non-deterministic
// (cryptographically-seeded) and designed to be wrapped in a DB unique-retry
// loop via `withUniqueRetry` so a collision is recovered invisibly.
//
// Prior versions used `Math.random()` + `Date.now().toString().slice(-8)`
// which collided in high-concurrency scenarios — two requests landing in the
// same millisecond got the same ID and one would fail the unique constraint
// without a retry. See audit 03-uniqueness.md.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Crockford-lite, no 0/O/1/I

function randomToken(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

function ymd(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** SCT-YYYYMMDD-XXXXXX (6 chars Crockford) — ~1e9 combos per day. */
export function generateBookingReference(date = new Date()): string {
  return `SCT-${ymd(date)}-${randomToken(6)}`;
}

/** WO-XXXXXXXX — 8-char token, ~1e12 combos. */
export function generateWorkOrderNumber(): string {
  return `WO-${randomToken(8)}`;
}

/** INC-XXXXXXXX */
export function generateIncidentNumber(prefix: "INC" | "INC-AUTO" = "INC"): string {
  return `${prefix}-${randomToken(8)}`;
}

/** INV-XXXXXXXX */
export function generateInvoiceNumber(): string {
  return `INV-${randomToken(8)}`;
}

/** TKT-XXXXXX */
export function generateTicketNumber(): string {
  return `TKT-${randomToken(6)}`;
}

/** Retry a Prisma mutation up to N times when the unique-constraint violation
 * is on a known generated-ID field — the caller passes a factory that
 * produces the record data (so a fresh ID is produced each attempt). */
export async function withUniqueRetry<T>(
  mutation: () => Promise<T>,
  opts: { maxAttempts?: number; constraintFields?: string[] } = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await mutation();
    } catch (err) {
      lastErr = err;
      if (!isUniqueViolation(err, opts.constraintFields)) throw err;
    }
  }
  throw lastErr;
}

function isUniqueViolation(err: unknown, fields?: string[]): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code !== "P2002") return false;
  if (!fields) return true;
  const meta = (err as { meta?: { target?: string[] } }).meta;
  const target = meta?.target ?? [];
  return target.some((t) => fields.includes(t));
}
