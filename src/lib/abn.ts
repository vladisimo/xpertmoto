/**
 * Australian Business Number (ABN) helpers.
 *
 * The ABN is an 11-digit identifier issued by the ATO. Format on screen
 * is conventionally `NN NNN NNN NNN`; we store it digits-only so the
 * format function can re-render any spacing scheme.
 *
 * `isValidAbnFormat` checks length only — adequate to reject obvious
 * typos at the form boundary. The ATO checksum is implemented in
 * `isValidAbnChecksum` and uses the standard weights [10, 1, 3, 5, 7, 9,
 * 11, 13, 15, 17, 19] with a `(d0 - 1)` adjustment on the first digit.
 */

export function normaliseAbn(input: string): string {
  return input.replace(/\D/g, "");
}

/** Return `NN NNN NNN NNN` if the input has 11 digits, else trim-only. */
export function formatAbn(input: string): string {
  const digits = normaliseAbn(input);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}

/** True if input is exactly 11 digits (after stripping spaces / dashes). */
export function isValidAbnFormat(input: string): boolean {
  return /^\d{11}$/.test(normaliseAbn(input));
}

/** True if input passes the ATO mod-89 checksum. */
export function isValidAbnChecksum(input: string): boolean {
  const digits = normaliseAbn(input);
  if (digits.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  // Adjust the first digit per the ABR algorithm.
  const first = parseInt(digits[0]!, 10) - 1;
  if (first < 0) return false;
  let sum = first * weights[0]!;
  for (let i = 1; i < 11; i++) {
    sum += parseInt(digits[i]!, 10) * weights[i]!;
  }
  return sum % 89 === 0;
}

/** Combined check used by Zod refinements in form schemas. */
export function isValidAbn(input: string): boolean {
  return isValidAbnFormat(input) && isValidAbnChecksum(input);
}
