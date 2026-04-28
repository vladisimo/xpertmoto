/**
 * Shared Zod validators for identity documents (driver's licence + passport).
 *
 * Used by the booking wizard step-details schema, the customer profile form,
 * and the /dashboard/documents page. A single source-of-truth so the customer
 * sees the same rule at every surface and the eligibility gate doesn't end
 * up rejecting something the UI accepted.
 *
 * The identity gate on the server (checkEligibility) accepts a valid licence
 * OR a valid passport. These validators enforce that contract at the form
 * layer with the same spirit: neither triplet is individually required, but
 * at least one must be complete and its expiry must not lapse before the
 * (form-level, best-effort) "today" check. The authoritative "does this
 * cover the pickup date" check is server-side in checkEligibility.
 */

import { z } from "zod";

export const AU_STATES = ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"] as const;
export type AuState = (typeof AU_STATES)[number];

/** A future-or-today ISO date string. Used by both licence and passport. */
const futureDateString = (messagePast: string) =>
  z.string().refine(
    (v) => {
      if (!v) return false;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return d >= today;
    },
    { message: messagePast },
  );

/** Passport number — letters + digits, 5–20 chars. Covers every passport
 *  format we're likely to see (AU: 1 letter + 7–8 digits; US/UK: 9 digits;
 *  most EU: 7–9 alphanumerics). Doesn't enforce a country-specific format —
 *  that would false-positive on overseas visitors which is the whole point
 *  of accepting passports. */
export const passportNumberSchema = z
  .string()
  .trim()
  .min(5, "Passport numbers are 5–20 characters long.")
  .max(20, "Passport numbers are 5–20 characters long.")
  .regex(/^[A-Z0-9]+$/i, "Passport numbers are letters and digits only.");

/** Passport country — accepts either ISO 3166-1 alpha-2 codes ("AU", "US")
 *  or full country names up to 56 chars (longest UN name is "United Kingdom
 *  of Great Britain and Northern Ireland"). */
export const passportCountrySchema = z
  .string()
  .trim()
  .min(2, "Which country issued this passport?")
  .max(56);

export const passportExpirySchema = futureDateString(
  "Your passport has expired — a current passport is required.",
);

export const licenceNumberSchema = z
  .string()
  .trim()
  .min(1, "Your licence number is required before we can hand over the keys.");

export const licenceStateSchema = z.enum(AU_STATES, {
  errorMap: () => ({ message: "Choose a licence state." }),
});

export const licenceExpirySchema = futureDateString(
  "Your licence has expired — you'll need a current licence to hire.",
);

/** A licence triplet (number + state + expiry) is "complete" when all three
 *  are present and the expiry is not in the past. `licenceClass` is not
 *  required at the form layer — staff may add it from the OCR later. */
export type LicenceTriplet = {
  number?: string;
  state?: string;
  expiry?: string;
  class?: string;
};

/** A passport triplet (number + country + expiry) is "complete" when all
 *  three are present and the expiry is not in the past. */
export type PassportTriplet = {
  number?: string;
  country?: string;
  expiry?: string;
};

/** Is this licence triplet complete enough to satisfy the identity gate? */
export function isLicenceComplete(l: LicenceTriplet | undefined | null): boolean {
  if (!l) return false;
  if (!l.number || !l.state || !l.expiry) return false;
  return licenceExpirySchema.safeParse(l.expiry).success;
}

/** Is this passport triplet complete enough to satisfy the identity gate?
 *  Checks field presence, number format, and that expiry is not in the past. */
export function isPassportComplete(p: PassportTriplet | undefined | null): boolean {
  if (!p) return false;
  if (!p.number || !p.country || !p.expiry) return false;
  if (!passportNumberSchema.safeParse(p.number).success) return false;
  return passportExpirySchema.safeParse(p.expiry).success;
}

/** Shared "at least one valid ID" check. Adds exactly one issue attached to
 *  a caller-chosen path if neither side is complete; no issues if either is
 *  complete (per-field issues are still raised by their own schemas). */
export function enforceAtLeastOneValidId(
  licence: LicenceTriplet | undefined | null,
  passport: PassportTriplet | undefined | null,
  ctx: z.RefinementCtx,
  anchorPath: (string | number)[] = ["licenceNumber"],
) {
  if (isLicenceComplete(licence) || isPassportComplete(passport)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: anchorPath,
    message: "Add either your driver's licence or your passport to continue.",
  });
}
