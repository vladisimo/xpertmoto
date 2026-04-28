import Papa from "papaparse";

/**
 * One driver row from the legacy CSV. Keys are the exact column names from
 * the export. All values are strings (CSV), empty cells come through as
 * `null` for ergonomics.
 */
export type DriverRawRow = Record<string, string | null>;

/**
 * Columns we know how to map. Unknown headers are surfaced in
 * `ParseResult.sanity.unknown` so an operator can spot source drift.
 */
export const KNOWN_COLUMNS = [
  "driver_id",
  "name",
  "status",
  "filter_found",
  "email",
  "mobile",
  "secondary_number",
  "address",
  "dob",
  "added_date",
  "referral_source",
  "outstanding_debt",
  "credit",
  "card_last4",
  "license_no",
  "license_state_issued",
  "license_expiry",
  "license_valid",
  "last_ra",
  "created_at",
  "images",
] as const;

export type KnownColumn = (typeof KNOWN_COLUMNS)[number];

/**
 * Columns that *must* be present for the import to proceed. The rest are
 * optional (nullable fields, defaults, or ignored).
 */
export const REQUIRED_COLUMNS: KnownColumn[] = ["driver_id", "email", "name"];

export interface DriverHeaderSanity {
  missing: string[];
  unknown: string[];
}

export interface DriverParseResult {
  headers: string[];
  rows: DriverRawRow[];
  /** 1-based CSV row number (header is row 1, first data row is row 2). */
  rowNumbers: number[];
  sanity: DriverHeaderSanity;
}

export class DriverParseError extends Error {}

/**
 * Parse a drivers CSV buffer into header-mapped rows. Strings are trimmed;
 * empty cells become `null`.
 */
export function parseDriversCsv(buffer: Buffer | string): DriverParseResult {
  const content = typeof buffer === "string" ? buffer : buffer.toString("utf-8");
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    // Only fatal: header failures. Row-level errors are non-fatal; papaparse
    // still emits the row with whatever fields it could parse.
    const fatal = parsed.errors.find((e) => e.type === "Delimiter" || e.type === "Quotes");
    if (fatal) {
      throw new DriverParseError(`CSV parse failed: ${fatal.message}`);
    }
  }

  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0) {
    throw new DriverParseError("No headers found in CSV.");
  }

  const known = new Set<string>(KNOWN_COLUMNS);
  const sanity: DriverHeaderSanity = {
    missing: REQUIRED_COLUMNS.filter((k) => !headers.includes(k)),
    unknown: headers.filter((h) => !known.has(h)),
  };

  const rows: DriverRawRow[] = [];
  const rowNumbers: number[] = [];
  parsed.data.forEach((raw, idx) => {
    const row: DriverRawRow = {};
    let hasAny = false;
    for (const key of headers) {
      const v = raw[key];
      const s = typeof v === "string" ? v.trim() : "";
      row[key] = s === "" ? null : s;
      if (row[key] !== null) hasAny = true;
    }
    if (!hasAny) return; // skip blank rows
    rows.push(row);
    rowNumbers.push(idx + 2); // header is row 1
  });

  return { headers, rows, rowNumbers, sanity };
}
