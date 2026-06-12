import { z } from "zod";

export const AU_STATES = ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"] as const;
export const RISK_RATINGS = ["LOW", "MEDIUM", "HIGH"] as const;
export const LOYALTY_TIERS = ["SILVER", "GOLD", "PLATINUM"] as const;

const AU_PHONE = /^[\d\s+()-]{8,15}$/;

export const CUSTOMER_IMPORT_COLUMNS = [
  { key: "email", header: "email", required: true },
  { key: "firstName", header: "firstName", required: true },
  { key: "lastName", header: "lastName", required: true },
  { key: "phone", header: "phone", required: false },
  { key: "dateOfBirth", header: "dateOfBirth", required: false },
  { key: "licenceNumber", header: "licenceNumber", required: false },
  { key: "licenceState", header: "licenceState", required: false },
  { key: "licenceExpiry", header: "licenceExpiry", required: false },
  { key: "licenceClass", header: "licenceClass", required: false },
  { key: "passportNumber", header: "passportNumber", required: false },
  { key: "passportCountry", header: "passportCountry", required: false },
  { key: "passportExpiry", header: "passportExpiry", required: false },
  { key: "emergencyContactName", header: "emergencyContactName", required: false },
  { key: "emergencyContactPhone", header: "emergencyContactPhone", required: false },
  { key: "emergencyContactRelationship", header: "emergencyContactRelationship", required: false },
  { key: "addressLine1", header: "addressLine1", required: false },
  { key: "addressLine2", header: "addressLine2", required: false },
  { key: "suburb", header: "suburb", required: false },
  { key: "state", header: "state", required: false },
  { key: "postcode", header: "postcode", required: false },
  { key: "country", header: "country", required: false },
  { key: "marketingOptIn", header: "marketingOptIn", required: false },
  { key: "marketingSmsOptIn", header: "marketingSmsOptIn", required: false },
  { key: "notes", header: "notes", required: false },
  { key: "riskRating", header: "riskRating", required: false },
  { key: "loyaltyTier", header: "loyaltyTier", required: false },
] as const;

export type CustomerImportColumnKey = (typeof CUSTOMER_IMPORT_COLUMNS)[number]["key"];

const emptyToUndefined = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  const s = typeof v === "string" ? v.trim() : v;
  return s === "" ? undefined : s;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const optionalTrimmedString = z.preprocess(
  (v) => {
    const s = emptyToUndefined(v);
    return typeof s === "string" ? s.trim() : s;
  },
  z.string().optional(),
);

const optionalBool = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return v; // let Zod flag it
}, z.boolean().optional());

// Accepts YYYY-MM-DD or any Date-parsable string. Emits a Date or undefined.
// Rejects values where Date parsing yields NaN.
const optionalDate = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "__invalid__" : v;
  const s = String(v).trim();
  if (!s) return undefined;
  // Strict YYYY-MM-DD fast path — avoids Date's "1 Jan 2001" tolerance.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    const [, y, m, d] = ymd;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      dt.getUTCFullYear() === Number(y) &&
      dt.getUTCMonth() === Number(m) - 1 &&
      dt.getUTCDate() === Number(d)
    ) {
      return dt;
    }
    return "__invalid__";
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? "__invalid__" : dt;
}, z.date().optional());

const phoneSchema = z.preprocess(
  (v) => {
    const s = emptyToUndefined(v);
    // Excel numeric cells (sheet_to_json raw:true) arrive as numbers with
    // the leading zero eaten — 0412 345 678 becomes 412345678. Every AU
    // local number starts with 0, so restore it; string cells untouched.
    if (typeof s === "number" && Number.isInteger(s) && s > 0) {
      return `0${s}`;
    }
    return s;
  },
  z
    .string()
    .optional()
    .refine((v) => !v || AU_PHONE.test(v), {
      message: "Invalid phone format (e.g. 0412 345 678)",
    }),
);

export const customerImportRowSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().min(1, "email is required").email("Invalid email"),
  ),
  firstName: z.preprocess(
    emptyToUndefined,
    z.string().min(1, "firstName is required"),
  ),
  lastName: z.preprocess(
    emptyToUndefined,
    z.string().min(1, "lastName is required"),
  ),
  phone: phoneSchema,
  dateOfBirth: optionalDate,
  licenceNumber: optionalTrimmedString,
  licenceState: z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      return typeof s === "string" ? s.toUpperCase() : s;
    },
    z
      .enum(AU_STATES, {
        errorMap: () => ({ message: `licenceState must be one of ${AU_STATES.join(", ")}` }),
      })
      .optional(),
  ),
  licenceExpiry: optionalDate,
  licenceClass: optionalTrimmedString,
  passportNumber: optionalTrimmedString,
  passportCountry: optionalTrimmedString,
  passportExpiry: optionalDate,
  emergencyContactName: optionalString,
  emergencyContactPhone: phoneSchema,
  emergencyContactRelationship: optionalString,
  addressLine1: optionalString,
  addressLine2: optionalString,
  suburb: optionalString,
  state: z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      return typeof s === "string" ? s.toUpperCase() : s;
    },
    z
      .enum(AU_STATES, {
        errorMap: () => ({ message: `state must be one of ${AU_STATES.join(", ")}` }),
      })
      .optional(),
  ),
  postcode: z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      if (typeof s !== "string" && typeof s !== "number") return s;
      // Numeric Excel cells drop leading zeros (NT postcode 0800 → 800);
      // re-pad to 4 digits. Typed strings stay strict.
      if (typeof s === "number") return String(s).padStart(4, "0");
      return String(s).trim();
    },
    z
      .string()
      .optional()
      .refine((v) => !v || /^\d{4}$/.test(v), {
        message: "postcode must be 4 digits",
      }),
  ),
  country: optionalString,
  marketingOptIn: optionalBool,
  marketingSmsOptIn: optionalBool,
  notes: optionalString,
  riskRating: z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      return typeof s === "string" ? s.toUpperCase() : s;
    },
    z
      .enum(RISK_RATINGS, {
        errorMap: () => ({ message: `riskRating must be one of ${RISK_RATINGS.join(", ")}` }),
      })
      .optional(),
  ),
  loyaltyTier: z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      return typeof s === "string" ? s.toUpperCase() : s;
    },
    z
      .enum(LOYALTY_TIERS, {
        errorMap: () => ({ message: `loyaltyTier must be one of ${LOYALTY_TIERS.join(", ")}` }),
      })
      .optional(),
  ),
});

export type CustomerImportRow = z.infer<typeof customerImportRowSchema>;
