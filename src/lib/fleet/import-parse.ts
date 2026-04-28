import * as XLSX from "xlsx";
import { ALL_KEYS, REQUIRED_KEYS } from "./import-columns";

/**
 * One row from the uploaded sheet, with header names as keys and values
 * still in their raw form (strings, numbers, or Date objects — we lean on
 * xlsx's `raw: false` formatter to keep things simple).
 */
export type RawRow = Record<string, string | number | Date | null | undefined>;

export interface HeaderSanity {
  missing: string[];
  unknown: string[];
}

export interface ParseResult {
  headers: string[];
  rows: RawRow[];
  /** 1-based worksheet row number for each row in `rows`, aligned by index. */
  rowNumbers: number[];
  sanity: HeaderSanity;
}

export class ParseError extends Error {}

const DATA_SHEET_CANDIDATES = ["Vehicles", "Fleet", "Sheet1"];

/**
 * Parse the first worksheet of an uploaded XLSX into header-mapped rows.
 * Throws {@link ParseError} with a user-safe message if the file isn't an
 * XLSX we can read. Header-mismatch errors are returned via
 * `sanity.missing` / `sanity.unknown` rather than thrown so the caller can
 * render them in a single preview summary.
 */
export function parseVehicleSheet(buffer: Buffer): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (err) {
    throw new ParseError(
      `Could not read file as XLSX: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  const sheetName =
    DATA_SHEET_CANDIDATES.find((name) => wb.SheetNames.includes(name)) ??
    wb.SheetNames[0];
  if (!sheetName) throw new ParseError("Workbook has no sheets.");
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new ParseError(`Sheet "${sheetName}" is empty.`);

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false,
    defval: null,
  });

  const headerRowIdx = findHeaderRow(aoa);
  if (headerRowIdx === -1) {
    throw new ParseError(
      `No header row found. Expected a row containing at least one of: ${REQUIRED_KEYS.join(", ")}.`,
    );
  }

  const headers = (aoa[headerRowIdx] ?? []).map((h) => String(h ?? "").trim());
  const knownSet = new Set(ALL_KEYS);
  const sanity: HeaderSanity = {
    missing: REQUIRED_KEYS.filter((k) => !headers.includes(k)),
    unknown: headers.filter((h) => h.length > 0 && !knownSet.has(h)),
  };

  // Detect the helper row the template ships with ("REQUIRED" / "optional" in
  // every cell) and skip it so it doesn't get validated as a real record.
  const HELPER_TOKENS = new Set(["REQUIRED", "optional"]);
  const isHelperRow = (row: unknown[] | undefined) => {
    if (!row) return false;
    const nonEmpty = row.filter((c) => c !== null && String(c).trim() !== "");
    if (nonEmpty.length === 0) return false;
    return nonEmpty.every((c) => HELPER_TOKENS.has(String(c).trim()));
  };

  const rows: RawRow[] = [];
  const rowNumbers: number[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const raw = aoa[i];
    if (!raw || raw.every((c) => c === null || String(c).trim() === "")) continue;
    if (isHelperRow(raw)) continue;
    const row: RawRow = {};
    headers.forEach((h, colIdx) => {
      if (!h) return;
      const value = raw[colIdx];
      row[h] = normaliseCell(value);
    });
    rows.push(row);
    rowNumbers.push(i + 1); // 1-based to match Excel's displayed row number
  }

  return { headers, rows, rowNumbers, sanity };
}

function findHeaderRow(aoa: unknown[][]): number {
  const knownSet = new Set(ALL_KEYS);
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const row = aoa[i];
    if (!row) continue;
    const cells = row.map((c) => String(c ?? "").trim());
    const matches = cells.filter((c) => knownSet.has(c)).length;
    if (matches >= 3) return i;
  }
  return -1;
}

function normaliseCell(value: unknown): RawRow[string] {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return value;
  const s = String(value).trim();
  return s === "" ? null : s;
}
