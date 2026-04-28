/**
 * Field-level diff helper for AuditLog.previousData / newData payloads.
 *
 * Compares a "before" snapshot (typically loaded from the database) against
 * an "after" snapshot (the values we're about to persist) and returns only
 * the fields that actually changed. This keeps audit rows small and makes
 * the staff Activity tab's "X: old → new" view meaningful instead of a wall
 * of unchanged state.
 */

export type DiffResult = {
  previousData: Record<string, unknown>;
  newData: Record<string, unknown>;
  changedFields: string[];
};

export type DiffOptions = {
  /**
   * Fields whose values should be masked to `"****<last4>"` in both the
   * previous and new payload — used for identity numbers (licence, passport)
   * so the audit row never carries plaintext PII even though we still want
   * to record that a change happened.
   */
  mask?: readonly string[];
};

/**
 * Compute the subset of fields that differ between `before` and `after`.
 * Returns `null` when nothing changed so callers can skip writing a row.
 *
 * Equality rules:
 *   - `null` and `undefined` are treated as the same "unset" value.
 *   - `Date` values are compared by ISO calendar day — lets the caller pass
 *     a `Date` from Prisma even when the input parsed a different time of
 *     day from an ISO string on the same calendar date.
 *   - Everything else uses strict `===`.
 */
export function computeFieldDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  opts: DiffOptions = {},
): DiffResult | null {
  const mask = new Set(opts.mask ?? []);
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const previousData: Record<string, unknown> = {};
  const newData: Record<string, unknown> = {};
  const changedFields: string[] = [];

  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (isEqual(a, b)) continue;
    changedFields.push(key);
    if (mask.has(key)) {
      previousData[key] = maskValue(a);
      newData[key] = maskValue(b);
    } else {
      previousData[key] = normalise(a);
      newData[key] = normalise(b);
    }
  }

  if (changedFields.length === 0) return null;
  return { previousData, newData, changedFields };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date && b instanceof Date) return dayStr(a) === dayStr(b);
  if (a instanceof Date || b instanceof Date) return false;
  return a === b;
}

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function maskValue(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value);
  if (str.length <= 4) return "****";
  return `****${str.slice(-4)}`;
}
