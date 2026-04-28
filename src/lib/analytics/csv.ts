/**
 * Minimal RFC-4180 CSV export for analytics widgets. Kept in a shared
 * module so every widget exports in the same shape: the header row is
 * the object keys of the first row, values are coerced to string, and
 * anything containing `,`, `"`, `\n`, or `\r` is quoted with `"`
 * escaped as `""`. Numbers preserved with full precision; dates ISO.
 */
export type CsvRow = Record<string, string | number | boolean | Date | null | undefined>;

function escape(value: unknown): string {
  if (value == null) return "";
  const s =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: readonly CsvRow[], columnOrder?: readonly string[]): string {
  if (rows.length === 0) return "";
  const keys = columnOrder ?? Object.keys(rows[0]!);
  const header = keys.map(escape).join(",");
  const body = rows.map((r) => keys.map((k) => escape(r[k])).join(",")).join("\r\n");
  return `${header}\r\n${body}`;
}

/**
 * Trigger a browser download of the rows as CSV. Filename is suffixed
 * with an ISO date automatically so repeat exports don't overwrite.
 */
export function downloadCsv(
  filename: string,
  rows: readonly CsvRow[],
  columnOrder?: readonly string[],
): void {
  const csv = toCsv(rows, columnOrder);
  const iso = new Date().toISOString().slice(0, 10);
  const full = filename.endsWith(".csv") ? filename : `${filename}-${iso}.csv`;
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = full;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
