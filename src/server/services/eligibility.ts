/**
 * Customer eligibility to rent a vehicle category.
 *
 * Three gates, evaluated in order:
 *   1. Age — customer's age on the pickup date must meet category.minAge.
 *   2. Identity — customer must hold at least one government ID (driver's
 *      licence OR passport) whose expiry is on or after the pickup date.
 *      Either document alone is sufficient for the identity gate, per the
 *      operator policy locked during the passport-parity work.
 *   3. Licence class — when the customer is relying on a licence, the class
 *      must satisfy the category's `licenceRequired`. Categories now record
 *      either CAR (covers 50cc scooters) or R (any motorcycle); since the
 *      operator no longer flags bikes as RE-only, an R requirement is
 *      satisfied by any motorcycle class on the customer's record — R, RE,
 *      RE_P1 or RE_P2.
 *
 * Note on passport-only customers: a valid passport satisfies the identity
 * gate for *any* vehicle category, including motorcycle classes where a
 * passport plainly doesn't grant riding privileges. This is deliberate — the
 * operator has accepted the regulatory exposure — and is surfaced to staff
 * via an advisory warning at check-out for RE/R categories. See
 * `CLASS_UNKNOWN_ON_PASSPORT_ONLY` below.
 */

/** Customer licence classes we recognise. Mirrors the free-text field on
 *  `CustomerProfile.licenceClass` — kept open for other strings to pass
 *  through as "unknown" and fail closed. */
export type LicenceClass = "CAR" | "RE_P1" | "RE_P2" | "RE" | "R";

/** What a category requires. Matches `VehicleCategory.licenceRequired`. */
export type RequiredLicence = "CAR" | "RE" | "R";

/** For each requirement, the classes that satisfy it. The fleet no longer
 *  marks bikes as RE-only, so an R requirement accepts any recognised
 *  motorcycle class — restricted (RE_P1 / RE_P2 / RE) and full (R) alike. */
const LICENCE_HIERARCHY: Record<RequiredLicence, ReadonlySet<LicenceClass>> = {
  CAR: new Set<LicenceClass>(["CAR", "RE_P1", "RE_P2", "RE", "R"]),
  RE: new Set<LicenceClass>(["RE_P1", "RE_P2", "RE", "R"]),
  R: new Set<LicenceClass>(["RE_P1", "RE_P2", "RE", "R"]),
};

function normaliseSingleClass(token: string): LicenceClass | null {
  const upper = token.toUpperCase().replace(/[\s-]/g, "_");
  if (upper === "CAR" || upper === "C") return "CAR";
  if (upper === "R") return "R";
  if (upper === "RE") return "RE";
  if (upper === "RE_P1" || upper === "REP1") return "RE_P1";
  if (upper === "RE_P2" || upper === "REP2") return "RE_P2";
  return null;
}

// Australian licences are often recorded as a comma/slash/plus-delimited
// list — "C, R", "C/R", "CAR+R". Normalise the whole field into the set of
// individual classes the holder carries.
function normaliseCustomerClasses(raw: string | null | undefined): Set<LicenceClass> {
  const out = new Set<LicenceClass>();
  if (!raw) return out;
  for (const token of raw.split(/[,/+|;&]/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const cls = normaliseSingleClass(trimmed);
    if (cls) out.add(cls);
  }
  return out;
}

function normaliseRequired(raw: string | null | undefined): RequiredLicence | null {
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[\s-]/g, "_");
  if (upper === "CAR" || upper === "C") return "CAR";
  if (upper === "R") return "R";
  if (upper === "RE") return "RE";
  return null;
}

export function licenceCovers(customer: string | null | undefined, required: string | null | undefined): boolean {
  const r = normaliseRequired(required);
  if (!r) return true; // category has no licence requirement recorded — fail open
  const classes = normaliseCustomerClasses(customer);
  if (classes.size === 0) return false;
  const satisfying = LICENCE_HIERARCHY[r];
  for (const c of classes) {
    if (satisfying.has(c)) return true;
  }
  return false;
}

export function ageOnDate(dob: Date, on: Date): number {
  const years = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) return years - 1;
  return years;
}

export type EligibilityFailureCode =
  | "AGE"
  | "LICENCE_CLASS"
  | "NO_VALID_ID"
  | "DOB_MISSING"
  | "MISSING_ID_IMAGE";

export type EligibilityFailure = {
  code: EligibilityFailureCode;
  message: string;
};

export type EligibilityWarning = {
  code: "CLASS_UNKNOWN_ON_PASSPORT_ONLY";
  message: string;
};

/** Which document(s) satisfied the identity gate. "none" is only returned
 *  alongside a `failure` with code `NO_VALID_ID`. */
export type EligibilityBasis = "licence" | "passport" | "both" | "none";

export type EligibilityResult = {
  failure: EligibilityFailure | null;
  basis: EligibilityBasis;
  warnings: EligibilityWarning[];
};

export type EligibilityInput = {
  customer: {
    dateOfBirth: Date | null;
    licenceClass: string | null;
    licenceExpiry: Date | null;
    passportNumber: string | null;
    passportExpiry: Date | null;
    /**
     * Identity gate path the customer chose at booking. AU_LICENCE → only a
     * driver's licence image is required. INTERNATIONAL → both passport and
     * IDP front images are required. Null/absent → image gate is skipped
     * (e.g. staff check-out re-verification, where physical sighting
     *  substitutes for an on-file image).
     */
    licenceType?: "AU_LICENCE" | "INTERNATIONAL" | null;
    licenceImageFront?: string | null;
    passportImage?: string | null;
  };
  category: {
    name: string;
    licenceRequired: string;
    minAge: number;
  };
  pickupDate: Date;
};

/** Returns `{ failure: null, basis, warnings }` when eligible, or a result
 *  with a non-null `failure` describing the first gate that closed. The
 *  `basis` tells audit + UI which document carried the decision; `warnings`
 *  is advisory only (never blocks). */
export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const { customer, category, pickupDate } = input;
  const warnings: EligibilityWarning[] = [];

  if (!customer.dateOfBirth) {
    return {
      failure: { code: "DOB_MISSING", message: "Date of birth required before booking this category." },
      basis: "none",
      warnings,
    };
  }

  const age = ageOnDate(customer.dateOfBirth, pickupDate);
  if (age < category.minAge) {
    return {
      failure: {
        code: "AGE",
        message: `${category.name} requires riders to be at least ${category.minAge} on the pickup date (you'll be ${age}).`,
      },
      basis: "none",
      warnings,
    };
  }

  const licencePresent = !!customer.licenceClass;
  const licenceExpired = !!customer.licenceExpiry && customer.licenceExpiry < pickupDate;
  const licenceValid = licencePresent && !licenceExpired;

  const passportValid =
    !!customer.passportNumber && !!customer.passportExpiry && customer.passportExpiry >= pickupDate;

  if (!licenceValid && !passportValid) {
    return {
      failure: {
        code: "NO_VALID_ID",
        message:
          "A current driver's licence or valid passport is required on file before this booking can proceed.",
      },
      basis: "none",
      warnings,
    };
  }

  // Image gate. Only enforced when the caller passes `licenceType` — staff
  // check-out re-verifies eligibility with `licenceType` omitted, since a
  // physical sighting at handover is the staff-side substitute for an
  // on-file image.
  if (customer.licenceType === "AU_LICENCE" && !customer.licenceImageFront) {
    return {
      failure: {
        code: "MISSING_ID_IMAGE",
        message: "A photo of your Australian driver's licence is required before this booking can proceed.",
      },
      basis: "none",
      warnings,
    };
  }
  if (customer.licenceType === "INTERNATIONAL") {
    const missing: string[] = [];
    if (!customer.licenceImageFront) missing.push("International Driver's Permit");
    if (!customer.passportImage) missing.push("passport");
    if (missing.length > 0) {
      return {
        failure: {
          code: "MISSING_ID_IMAGE",
          message: `Photos of your ${missing.join(" and ")} are required before this booking can proceed.`,
        },
        basis: "none",
        warnings,
      };
    }
  }

  const required = normaliseRequired(category.licenceRequired);

  // Licence path — only taken when the licence itself is valid *and* covers
  // the category class. When the licence is valid but doesn't cover the
  // category and there's no passport, the licence-class failure is the
  // truthful answer; when there is a passport, the passport path takes over.
  if (licenceValid && licenceCovers(customer.licenceClass, category.licenceRequired)) {
    return {
      failure: null,
      basis: passportValid ? "both" : "licence",
      warnings,
    };
  }

  // Passport path. Class is unknown by construction (no licence on file, or
  // licence doesn't cover) — for motorcycle categories that's advisory.
  if (passportValid) {
    if (required === "RE" || required === "R") {
      warnings.push({
        code: "CLASS_UNKNOWN_ON_PASSPORT_ONLY",
        message: `${category.name} requires a ${category.licenceRequired} motorcycle licence. Eligibility passed on passport alone — sight the rider's licence in person before handover.`,
      });
    }
    return {
      failure: null,
      basis: "passport",
      warnings,
    };
  }

  // Licence present but wrong class, no passport — close on class.
  return {
    failure: {
      code: "LICENCE_CLASS",
      message: `${category.name} requires a ${category.licenceRequired} licence or higher — your ${customer.licenceClass ?? "recorded"} licence doesn't cover this category. Add a passport on file to rely on passport-only ID.`,
    },
    basis: "none",
    warnings,
  };
}
