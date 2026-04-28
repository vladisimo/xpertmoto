import type { ColumnDef } from "./index";
import { computeFooterRow, formatCell } from "./index";

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv<T>(rows: T[], columns: ColumnDef<T>[]): string {
  const BOM = "\uFEFF";
  const lines: string[] = [];

  lines.push(columns.map((c) => escapeCell(c.header)).join(","));

  for (const row of rows) {
    const cells = columns.map((c) => {
      const raw = row[c.key];
      if (c.format === "currency" || c.format === "number") {
        const num = Number(raw);
        return Number.isFinite(num) ? String(num) : "";
      }
      if (c.format === "percent") {
        const num = Number(raw);
        return Number.isFinite(num) ? String(num) : "";
      }
      return escapeCell(formatCell(raw, c.format));
    });
    lines.push(cells.join(","));
  }

  const footer = computeFooterRow(rows, columns);
  if (footer) {
    const cells = columns.map((c) => {
      const raw = (footer as Record<string, unknown>)[c.key];
      if (raw === undefined) return c === columns[0] ? escapeCell("Total") : "";
      if (c.format === "currency" || c.format === "number" || c.format === "percent") {
        const num = Number(raw);
        return Number.isFinite(num) ? String(num) : "";
      }
      return escapeCell(formatCell(raw, c.format));
    });
    lines.push(cells.join(","));
  }

  return BOM + lines.join("\r\n") + "\r\n";
}
