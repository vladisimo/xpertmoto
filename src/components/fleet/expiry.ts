export type ExpiryTone = "expired" | "soon" | null;

/**
 * Shared expiry classifier for compliance dates across the fleet UI.
 * The Overview tab uses the default 7-day warning window (tight, because
 * an expired rego needs urgent action). The Documents tab passes 30 to
 * get a wider "expires soon" band that matches the admin reminder cycle.
 */
export function expiryTone(
  value: Date | string | null | undefined,
  warningDays = 7,
): ExpiryTone {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 0) return "expired";
  if (diffMs <= warningDays * 24 * 60 * 60 * 1000) return "soon";
  return null;
}
