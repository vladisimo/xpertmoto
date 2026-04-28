import { Prisma } from "@prisma/client";

// Shared money utilities. All AUD arithmetic in the system goes through
// these helpers to preserve precision. Using `Prisma.Decimal` (a re-export
// of decimal.js shipped with @prisma/client) means we never see IEEE-754
// rounding artefacts like $57.14285714285714 that legacy `.toNumber() * n`
// paths produced.
//
// Conventions:
//   - "AUD" values are Prisma.Decimal or a numeric-like we can coerce.
//   - Internal calculations stay as Decimal end-to-end.
//   - Only convert to `number` at the final presentation / DB-write step
//     via `.toNumber()` — and even then, only after a `.round(2)` pass.

type Numeric = number | string | Prisma.Decimal | bigint | null | undefined;

/** Coerce anything number-ish to a Prisma.Decimal. `null` / `undefined` → 0. */
export function aud(value: Numeric): Prisma.Decimal {
  if (value == null) return new Prisma.Decimal(0);
  if (value instanceof Prisma.Decimal) return value;
  if (typeof value === "bigint") return new Prisma.Decimal(value.toString());
  return new Prisma.Decimal(value);
}

/** Round a Decimal to 2 dp (nearest cent, half-up). */
export function roundCents(value: Numeric): Prisma.Decimal {
  return aud(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** CLAUDE.md rule #4: GST = total / 11 (GST-inclusive pricing). */
export function gstFromInclusive(totalInclusive: Numeric): Prisma.Decimal {
  return roundCents(aud(totalInclusive).div(11));
}

/** Subtotal (ex-GST) given a GST-inclusive total. */
export function subtotalExGst(totalInclusive: Numeric): Prisma.Decimal {
  const total = aud(totalInclusive);
  const gst = gstFromInclusive(total);
  return roundCents(total.minus(gst));
}

/** Sum any number of monetary values, preserving Decimal precision. */
export function sum(...values: Numeric[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(aud(v)), new Prisma.Decimal(0));
}

/** Multiply a Decimal by a plain integer / scalar. */
export function times(value: Numeric, scalar: Numeric): Prisma.Decimal {
  return aud(value).times(aud(scalar));
}

/** Divide two Decimal-compatible values; result is NOT rounded. */
export function divide(value: Numeric, divisor: Numeric): Prisma.Decimal {
  return aud(value).div(aud(divisor));
}

/** Apply a percentage discount: amount * (1 - pct) where pct is 0..1. */
export function applyPercentage(value: Numeric, pct: Numeric): Prisma.Decimal {
  const factor = new Prisma.Decimal(1).minus(aud(pct));
  return aud(value).times(factor);
}

/** Apply a multiplier (season/yield/demand). */
export function multiply(value: Numeric, factor: Numeric): Prisma.Decimal {
  return aud(value).times(aud(factor));
}

/** Compare two monetary values. */
export function eq(a: Numeric, b: Numeric): boolean {
  return aud(a).equals(aud(b));
}
export function gt(a: Numeric, b: Numeric): boolean {
  return aud(a).greaterThan(aud(b));
}
export function gte(a: Numeric, b: Numeric): boolean {
  return aud(a).greaterThanOrEqualTo(aud(b));
}
export function lt(a: Numeric, b: Numeric): boolean {
  return aud(a).lessThan(aud(b));
}
export function max(a: Numeric, b: Numeric): Prisma.Decimal {
  return gt(a, b) ? aud(a) : aud(b);
}

/** Convert a Decimal AUD amount to integer cents for Stripe. Rounds half-up. */
export function toStripeCents(value: Numeric): number {
  return roundCents(value).times(100).toNumber();
}

/** Convert integer cents (from Stripe / ledger) back to a Decimal AUD. */
export function fromStripeCents(cents: number | null | undefined): Prisma.Decimal {
  if (cents == null) return new Prisma.Decimal(0);
  return new Prisma.Decimal(cents).div(100);
}

/** For legacy call sites that still require a plain `number`. Prefer passing
 *  Decimals where possible. */
export function toNumber(value: Numeric): number {
  return roundCents(value).toNumber();
}

/** Format as an en-AU currency string. */
export function formatAud(value: Numeric): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(
    roundCents(value).toNumber(),
  );
}
