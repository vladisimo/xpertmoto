import type { CustomerDocumentType, UserStatus } from "@prisma/client";
import type { DriverRawRow } from "./import-parse";

/**
 * Output of a single-row validation — either fully validated data ready
 * to persist, or a list of reasons the row can't be imported.
 */
export type RowValidation =
  | { status: "ok"; row: ValidatedDriver }
  | { status: "skip"; reason: SkipReason; note?: string }
  | { status: "error"; issues: string[] };

export type SkipReason =
  /** Row has no email — can't build a unique User. */
  | "missing_email"
  /** Another row with the same email had a higher driver_id. */
  | "duplicate_email_older_row"
  /** Row's `driver_id` appears more than once in the file (non-idempotent). */
  | "duplicate_driver_id";

/**
 * A row that passed validation and is ready for the import transaction.
 */
export interface ValidatedDriver {
  legacyDriverId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  dateOfBirth: Date | null;
  status: UserStatus;
  softDelete: boolean;
  createdAt: Date | null;
  profile: {
    secondaryPhone: string | null;
    legacyReferralSource: string | null;
    addressLine1: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    licenceNumber: string | null;
    licenceState: string | null;
    licenceExpiry: Date | null;
  };
  images: ImageRef[];
}

export interface ImageRef {
  /** Filename as it appears in the `images` column. */
  filename: string;
  /** How this image should be stored. */
  target:
    | { kind: "customerDocument"; type: CustomerDocumentType }
    | { kind: "signatureImage" };
}

/** The DOB sentinel used by the legacy system when no real DOB was known. */
const DOB_PLACEHOLDER_ISO = "1970-01-01";

/**
 * Validate and normalise a single driver row. Does not hit the DB — all
 * cross-row checks (duplicate emails, duplicate driver_ids) happen later in
 * `validateDriverBatch`.
 */
export function validateDriverRow(
  raw: DriverRawRow,
): RowValidation {
  const issues: string[] = [];

  const legacyDriverId = raw.driver_id?.trim();
  if (!legacyDriverId) issues.push("missing driver_id");

  const email = normaliseEmail(raw.email);
  if (!email) {
    return { status: "skip", reason: "missing_email" };
  }

  const { firstName, lastName } = splitName(raw.name);
  if (!firstName) issues.push("missing name");

  if (issues.length > 0) return { status: "error", issues };

  const phone = normalisePhone(raw.mobile);
  const dateOfBirth = parseDobOrNull(raw.dob);
  const createdAt = parseDateTime(raw.added_date ?? raw.created_at);
  const { status, softDelete } = mapStatus(raw.status);

  const address = parseAustralianAddress(raw.address);

  const licenceNumber = normaliseLicenceNumber(raw.license_no);
  const licenceState = normaliseLicenceState(raw.license_state_issued);
  const licenceExpiry = parseDate(raw.license_expiry);

  const images = mapImages(legacyDriverId!, raw.images);

  return {
    status: "ok",
    row: {
      legacyDriverId: legacyDriverId!,
      email,
      firstName: firstName!,
      lastName: lastName ?? "",
      phone,
      dateOfBirth,
      status,
      softDelete,
      createdAt,
      profile: {
        secondaryPhone: raw.secondary_number?.trim() || null,
        legacyReferralSource: raw.referral_source?.trim() || null,
        addressLine1: address.line1,
        suburb: address.suburb,
        state: address.state,
        postcode: address.postcode,
        licenceNumber,
        licenceState,
        licenceExpiry,
      },
      images,
    },
  };
}

export interface BatchValidationResult {
  ok: ValidatedDriver[];
  skipped: Array<{
    rowNumber: number;
    legacyDriverId: string | null;
    email: string | null;
    reason: SkipReason;
    note?: string;
  }>;
  errored: Array<{
    rowNumber: number;
    legacyDriverId: string | null;
    email: string | null;
    issues: string[];
  }>;
}

/**
 * Validate all rows, applying cross-row rules: dedupe by email (keep the
 * row with the highest `driver_id`) and detect duplicate driver_ids. Input
 * rows do not need to be pre-sorted — we sort internally.
 */
export function validateDriverBatch(
  rows: DriverRawRow[],
  rowNumbers: number[],
): BatchValidationResult {
  const result: BatchValidationResult = { ok: [], skipped: [], errored: [] };

  // First pass: per-row validation. Keep alongside the row number and a
  // numeric form of the driver_id for later sorting.
  type Candidate = {
    rowNumber: number;
    rawDriverId: string | null;
    numericId: number;
    validation: RowValidation;
    emailForDedup: string | null;
  };
  const candidates: Candidate[] = rows.map((raw, i) => {
    const rawDriverId = raw.driver_id?.trim() ?? null;
    const numericId = rawDriverId ? Number.parseInt(rawDriverId, 10) || 0 : 0;
    const validation = validateDriverRow(raw);
    const email =
      validation.status === "ok"
        ? validation.row.email
        : normaliseEmail(raw.email);
    return {
      rowNumber: rowNumbers[i] ?? i + 2,
      rawDriverId,
      numericId,
      validation,
      emailForDedup: email,
    };
  });

  // Detect duplicate driver_ids across the file (breaks idempotency key).
  const idSeen = new Map<string, number>();
  for (const c of candidates) {
    if (!c.rawDriverId) continue;
    idSeen.set(c.rawDriverId, (idSeen.get(c.rawDriverId) ?? 0) + 1);
  }

  // Dedupe by email: highest driver_id wins, others get skipped.
  const emailWinner = new Map<string, number>(); // email -> winning numericId
  for (const c of candidates) {
    if (!c.emailForDedup) continue;
    const prev = emailWinner.get(c.emailForDedup);
    if (prev === undefined || c.numericId > prev) {
      emailWinner.set(c.emailForDedup, c.numericId);
    }
  }

  for (const c of candidates) {
    const common = {
      rowNumber: c.rowNumber,
      legacyDriverId: c.rawDriverId,
      email: c.emailForDedup,
    };

    if (c.validation.status === "error") {
      result.errored.push({ ...common, issues: c.validation.issues });
      continue;
    }
    if (c.validation.status === "skip") {
      result.skipped.push({ ...common, reason: c.validation.reason });
      continue;
    }

    // validation.status === "ok"
    if (c.rawDriverId && (idSeen.get(c.rawDriverId) ?? 0) > 1) {
      result.skipped.push({
        ...common,
        reason: "duplicate_driver_id",
        note: `driver_id '${c.rawDriverId}' appears ${idSeen.get(c.rawDriverId)} times`,
      });
      continue;
    }
    if (c.emailForDedup && emailWinner.get(c.emailForDedup) !== c.numericId) {
      result.skipped.push({
        ...common,
        reason: "duplicate_email_older_row",
        note: `superseded by driver_id ${emailWinner.get(c.emailForDedup)}`,
      });
      continue;
    }

    result.ok.push(c.validation.row);
  }

  return result;
}

// ---------- helpers ----------

function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  // Extremely loose email sanity — the legacy CSV has a few typos like
  // "@gmail.om" we can't silently correct, but we should at least reject
  // blanks and obvious whitespace-only cells.
  return /\S+@\S+\.\S+/.test(lower) ? lower : null;
}

function splitName(raw: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  if (!raw) return { firstName: null, lastName: null };
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * Normalise a phone into E.164-ish. Legacy CSV has `+61` with no digits
 * after (broken data) — those become null.
 */
function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Strip everything except digits and leading +
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned || cleaned === "+" || cleaned === "+61") return null;
  // Numbers under 6 digits are obviously junk.
  if (cleaned.replace(/\D/g, "").length < 6) return null;
  return cleaned;
}

/**
 * Parse a DD/MM/YYYY DOB. Returns null for blank, unparseable, or the
 * legacy 01/01/1970 sentinel value.
 */
function parseDobOrNull(raw: string | null | undefined): Date | null {
  const d = parseDate(raw);
  if (!d) return null;
  if (d.toISOString().startsWith(DOB_PLACEHOLDER_ISO)) return null;
  return d;
}

/**
 * Parse DD/MM/YYYY.  Handles common whitespace.  Returns null on failure
 * without throwing — the caller decides whether nulls are acceptable.
 */
function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const year = yyyy!.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
  const month = Number(mm) - 1;
  const day = Number(dd);
  if (year < 1900 || year > 2100 || month < 0 || month > 11 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return d;
}

/**
 * Parse the legacy `added_date` or `created_at` — format is
 * `DD/MM/YYYY HH:mm` (24-hour).
 */
function parseDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return parseDate(raw);
  const [, dd, mm, yyyy, hh, min, sec] = m;
  const year = yyyy!.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
  const d = new Date(
    Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(sec ?? 0)),
  );
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Map legacy `status` string → User.status + soft-delete flag.
 *
 * - "Active" → ACTIVE, not soft-deleted
 * - "Archived" → SUSPENDED, soft-deleted (deletedAt = now)
 * - anything else → SUSPENDED, not soft-deleted (safe default)
 */
function mapStatus(raw: string | null | undefined): {
  status: UserStatus;
  softDelete: boolean;
} {
  const v = raw?.trim().toLowerCase();
  if (v === "active") return { status: "ACTIVE", softDelete: false };
  if (v === "archived") return { status: "SUSPENDED", softDelete: true };
  return { status: "SUSPENDED", softDelete: false };
}

/**
 * Parse an Australian address. Best-effort: if the format is recognisable
 * we split into fields, otherwise the full string lands in `line1` and
 * other fields are null. Recognised patterns (observed in CSV):
 *
 *   "123 Foo St Suburb, NSW 2000"
 *   "123 Foo St  Suburb, NSW 2000"
 *   "Suburb, NSW 2000"
 *   "123 Foo Street, Suburb NSW 2000"
 */
function parseAustralianAddress(
  raw: string | null | undefined,
): { line1: string | null; suburb: string | null; state: string | null; postcode: string | null } {
  if (!raw) return { line1: null, suburb: null, state: null, postcode: null };
  const s = raw.trim();
  if (!s) return { line1: null, suburb: null, state: null, postcode: null };

  // Match a trailing ", STATE NNNN" or " STATE NNNN" at end of string.
  const tail = s.match(
    /^(.*?),?\s*([A-Z]{2,3}|NT|ACT|NSW|VIC|QLD|SA|TAS|WA)\s+(\d{4})\s*$/,
  );
  if (!tail) return { line1: s, suburb: null, state: null, postcode: null };

  const [, before, state, postcode] = tail;
  // Split suburb off the end of `before`: pattern is "<street>, <suburb>" or "<street> <suburb>"
  const beforeTrim = before!.trim().replace(/,$/, "").trim();
  const suburbMatch = beforeTrim.match(/^(.*?),\s*([^,]+)$/);
  if (suburbMatch) {
    return {
      line1: suburbMatch[1]!.trim() || null,
      suburb: suburbMatch[2]!.trim() || null,
      state: state!.toUpperCase(),
      postcode: postcode!,
    };
  }
  return {
    line1: beforeTrim || null,
    suburb: null,
    state: state!.toUpperCase(),
    postcode: postcode!,
  };
}

/**
 * Legacy system used "NA-*" as placeholders for unknown licences. These
 * are useless to us and would block the `licenceNumber` index with junk.
 */
function normaliseLicenceNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^NA-/i.test(trimmed)) return null;
  return trimmed;
}

function normaliseLicenceState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/**
 * Classify each filename in the `images` cell by its suffix. Returns
 * only files whose pattern we recognise; unknown patterns are left for
 * the caller to log to the import report.
 */
export function mapImages(driverId: string, raw: string | null | undefined): ImageRef[] {
  return classifyImageCell(driverId, raw).classified;
}

/**
 * Like `mapImages`, but also returns the filenames that had no recognised
 * suffix — used by the import script to log unknown-pattern issues to the
 * report without re-parsing the images cell.
 */
export function classifyImageCell(
  driverId: string,
  raw: string | null | undefined,
): { classified: ImageRef[]; unknown: string[] } {
  if (!raw) return { classified: [], unknown: [] };
  const filenames = raw.split(";").map((f) => f.trim()).filter(Boolean);
  const classified: ImageRef[] = [];
  const unknown: string[] = [];
  for (const filename of filenames) {
    const type = classifyImage(driverId, filename);
    if (type) classified.push({ filename, target: type });
    else unknown.push(filename);
  }
  return { classified, unknown };
}

function classifyImage(
  driverId: string,
  filename: string,
): ImageRef["target"] | null {
  const base = filename.toLowerCase();
  const id = driverId.toLowerCase();
  // The CSV is flat — filenames are `{id}_<suffix>.<ext>`. The `id` prefix
  // is always the driver_id, but we don't require it to match (in case
  // the operator renames on disk).
  if (base.includes("license_front")) {
    return { kind: "customerDocument", type: "LICENCE_FRONT" };
  }
  if (base.includes("license_back")) {
    return { kind: "customerDocument", type: "LICENCE_BACK" };
  }
  if (base.includes("dlpassport")) {
    return { kind: "customerDocument", type: "PASSPORT_STYLE_DL" };
  }
  if (base.includes("passport")) {
    return { kind: "customerDocument", type: "PASSPORT" };
  }
  if (base.includes("signature")) {
    return { kind: "signatureImage" };
  }
  // Fallback: filenames like `{id}.jpg` with no suffix. Unclassifiable.
  void id;
  return null;
}
