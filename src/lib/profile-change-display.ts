/**
 * Format profile-update change-sets for customer-facing emails.
 *
 * The audit-side `computeFieldDiff` (src/server/services/profile-diff.ts)
 * stores raw before/after values keyed by Prisma column name. Customer
 * emails need humanised labels, formatted dates, masked PII, and "(empty)"
 * fallbacks. Keep formatting in one place so PROFILE_UPDATED_SELF and
 * PROFILE_UPDATED_STAFF render identically and any new field landing on
 * the profile only needs a label entry below.
 */

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  dateOfBirth: "Date of birth",
  password: "Password",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  suburb: "Suburb",
  state: "State",
  postcode: "Postcode",
  country: "Country",
  emergencyContactName: "Emergency contact",
  emergencyContactPhone: "Emergency contact phone",
  emergencyContactRelationship: "Emergency contact relationship",
  marketingOptIn: "Marketing emails",
  marketingSmsOptIn: "Marketing SMS",
  licenceNumber: "Licence number",
  licenceState: "Licence state",
  licenceExpiry: "Licence expiry",
  licenceClass: "Licence class",
  licenceType: "Licence type",
  licenceCountry: "Licence country",
  passportNumber: "Passport number",
  passportCountry: "Passport country",
  passportExpiry: "Passport expiry",
  companyName: "Company name",
  abn: "ABN",
};

// Fields whose values are sensitive enough that we never echo the full
// value back in an email. Showing only a "changed" marker tells the
// customer something happened without putting the secret on the wire.
const SECRET_FIELDS = new Set<string>([
  "password",
  "licenceNumberEnc",
  "passportNumberEnc",
]);

// Fields whose values get masked to last-4 (e.g. "****1234") rather than
// fully redacted — enough for the customer to recognise the value, not
// enough for an interceptor to misuse.
const MASK_FIELDS = new Set<string>([
  "licenceNumber",
  "passportNumber",
]);

const DATE_FIELDS = new Set<string>([
  "dateOfBirth",
  "licenceExpiry",
  "passportExpiry",
]);

const BOOLEAN_FIELDS = new Set<string>([
  "marketingOptIn",
  "marketingSmsOptIn",
]);

export type ChangeRow = {
  /** Human-readable field name (e.g. "Phone"). */
  label: string;
  /** Formatted previous value or "(empty)" when unset. */
  previous: string;
  /** Formatted new value or "(empty)" when unset. */
  current: string;
};

function maskLast4(value: unknown): string {
  if (value == null) return "(empty)";
  const str = String(value);
  if (str.length <= 4) return "****";
  return `****${str.slice(-4)}`;
}

function formatValue(field: string, value: unknown): string {
  if (SECRET_FIELDS.has(field)) return "(updated)";
  if (MASK_FIELDS.has(field)) return maskLast4(value);
  if (value == null || value === "") return "(empty)";
  if (DATE_FIELDS.has(field)) {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-AU", { dateStyle: "medium" });
  }
  if (BOOLEAN_FIELDS.has(field)) return value ? "Yes" : "No";
  return String(value);
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Build the change-row list for the email template. Pass `previousData`
 * and `newData` from the audit snapshot (or just `newData` and a list of
 * field names if no before-snapshot is available — in that case
 * `previous` is rendered as "(unknown)").
 */
export function buildProfileChangeRows(args: {
  previousData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  /** Optional fallback when no diff snapshot exists — render only the
   * field names without before/after values. */
  changedFields?: readonly string[];
}): ChangeRow[] {
  const fields =
    args.changedFields && args.changedFields.length > 0
      ? args.changedFields
      : Array.from(
          new Set([
            ...Object.keys(args.previousData ?? {}),
            ...Object.keys(args.newData ?? {}),
          ]),
        );
  const skipPaired = new Set<string>();
  const rows: ChangeRow[] = [];
  for (const f of fields) {
    if (skipPaired.has(f)) continue;
    // Collapse `*Enc` companion fields (set when the encrypted column is
    // updated) into the single user-facing field name so the customer
    // doesn't see "Licence number" and "Licence number enc" as two rows.
    let resolved = f;
    if (f === "licenceNumberEnc") {
      resolved = "licenceNumber";
      skipPaired.add("licenceNumber");
    } else if (f === "passportNumberEnc") {
      resolved = "passportNumber";
      skipPaired.add("passportNumber");
    } else if (f === "licenceNumber" && fields.includes("licenceNumberEnc")) {
      skipPaired.add("licenceNumberEnc");
    } else if (f === "passportNumber" && fields.includes("passportNumberEnc")) {
      skipPaired.add("passportNumberEnc");
    }
    rows.push({
      label: labelFor(resolved),
      previous:
        args.previousData && resolved in args.previousData
          ? formatValue(resolved, args.previousData[resolved])
          : "(unknown)",
      current:
        args.newData && resolved in args.newData
          ? formatValue(resolved, args.newData[resolved])
          : "(updated)",
    });
  }
  return rows;
}
