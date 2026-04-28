import * as XLSX from "xlsx";
import type { ColumnDef, ExportMeta } from "./index";
import { computeFooterRow } from "./index";

const NUMBER_FORMATS: Record<NonNullable<ColumnDef<unknown>["format"]>, string> = {
  currency: '"$"#,##0.00',
  number: "#,##0",
  percent: "0.00%",
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
  text: "@",
};

function toSerialDate(value: unknown): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return (d.getTime() - epoch) / 86400000;
}

function cellValue<T>(col: ColumnDef<T>, raw: unknown) {
  if (raw === null || raw === undefined || raw === "") return { v: "" as const };
  switch (col.format) {
    case "currency":
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? { v: n, t: "n" as const, z: NUMBER_FORMATS[col.format] } : { v: "" as const };
    }
    case "percent": {
      const n = Number(raw);
      return Number.isFinite(n) ? { v: n, t: "n" as const, z: NUMBER_FORMATS.percent } : { v: "" as const };
    }
    case "date":
    case "datetime": {
      const serial = toSerialDate(raw);
      return serial != null ? { v: serial, t: "n" as const, z: NUMBER_FORMATS[col.format] } : { v: "" as const };
    }
    case "text":
    default:
      return { v: String(raw), t: "s" as const };
  }
}

export interface XlsxOptions {
  sheetName?: string;
  meta?: ExportMeta;
}

export function toXlsx<T>(rows: T[], columns: ColumnDef<T>[], opts: XlsxOptions = {}): Buffer {
  const sheetName = (opts.sheetName ?? "Report").slice(0, 31);
  const ncols = columns.length;

  const aoa: unknown[][] = [];

  if (opts.meta) {
    aoa.push([opts.meta.title]);
    const subtitleParts: string[] = [];
    if (opts.meta.subtitle) subtitleParts.push(opts.meta.subtitle);
    subtitleParts.push(`Generated ${opts.meta.generatedAt.toLocaleString("en-AU")}`);
    if (opts.meta.filters.length > 0) {
      subtitleParts.push(
        opts.meta.filters.map((f) => `${f.label}: ${f.value}`).join(" · "),
      );
    }
    aoa.push([subtitleParts.join(" · ")]);
    aoa.push([]);
  }

  aoa.push(columns.map((c) => c.header));

  for (const row of rows) {
    aoa.push(columns.map((c) => row[c.key]));
  }

  const footer = computeFooterRow(rows, columns);
  if (footer) {
    aoa.push(
      columns.map((c, idx) => {
        const v = (footer as Record<string, unknown>)[c.key];
        if (v !== undefined) return v;
        return idx === 0 ? "Total" : "";
      }),
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa.map((r) => r.map(() => ""))); // placeholder sized sheet
  const headerRowIndex = opts.meta ? 3 : 0;

  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const raw = row[c];
      if (opts.meta && r === 0) {
        ws[addr] = { v: String(raw ?? ""), t: "s", s: { font: { bold: true, sz: 14 } } };
        continue;
      }
      if (opts.meta && r === 1) {
        ws[addr] = { v: String(raw ?? ""), t: "s", s: { font: { sz: 9, color: { rgb: "666666" } } } };
        continue;
      }
      if (r === headerRowIndex) {
        ws[addr] = { v: String(raw ?? ""), t: "s", s: { font: { bold: true }, fill: { fgColor: { rgb: "1B6B4A" } } } };
        continue;
      }
      if (r > headerRowIndex) {
        const col = columns[c];
        if (col) {
          ws[addr] = cellValue(col, raw) as XLSX.CellObject;
        } else {
          ws[addr] = { v: String(raw ?? ""), t: "s" };
        }
      }
    }
  }

  const lastRow = aoa.length - 1;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: Math.max(ncols - 1, 0) } });

  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? Math.max(c.header.length + 2, 12) }));

  if (opts.meta) {
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(ncols - 1, 0) } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(ncols - 1, 0) } },
    ];
  }

  ws["!freeze"] = { xSplit: 0, ySplit: headerRowIndex + 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
}
