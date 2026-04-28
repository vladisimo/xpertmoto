import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

export type ColumnFormat = "text" | "currency" | "date" | "datetime" | "number" | "percent";

export interface ColumnDef<T> {
  key: keyof T & string;
  header: string;
  width?: number;
  format?: ColumnFormat;
  footer?: "sum" | "avg" | null;
  align?: "left" | "right" | "center";
}

export interface ExportBrand {
  name: string;
  abn: string;
  email: string;
  website: string;
}

export interface ExportFilter {
  label: string;
  value: string;
}

export interface ExportMeta {
  title: string;
  subtitle?: string;
  generatedAt: Date;
  filters: ExportFilter[];
  brand: ExportBrand;
}

// Neutral placeholder — each report export endpoint overrides this with
// values from `getBranding()` at request time (see
// `src/app/api/admin/reports/export/route.ts`). Kept here so registry
// entries can type-check without touching an async boundary.
export const DEFAULT_BRAND: ExportBrand = {
  name: "",
  abn: "",
  email: "",
  website: "",
};

export function formatCell(value: unknown, format: ColumnFormat | undefined): string {
  if (value === null || value === undefined) return "";
  switch (format) {
    case "currency":
      return formatCurrency(Number(value));
    case "date":
      return formatDate(value as Date | string);
    case "datetime":
      return formatDateTime(value as Date | string);
    case "number":
      return Number(value).toLocaleString("en-AU");
    case "percent":
      return `${(Number(value) * 100).toFixed(2)}%`;
    case "text":
    default:
      return String(value);
  }
}

export function computeFooterRow<T>(rows: T[], columns: ColumnDef<T>[]): Partial<T> | null {
  const hasFooter = columns.some((c) => c.footer);
  if (!hasFooter || rows.length === 0) return null;
  const result: Record<string, unknown> = {};
  for (const col of columns) {
    if (!col.footer) continue;
    const values = rows.map((r) => Number(r[col.key])).filter((n) => Number.isFinite(n));
    if (values.length === 0) continue;
    const sum = values.reduce((a, b) => a + b, 0);
    result[col.key] = col.footer === "avg" ? sum / values.length : sum;
  }
  return result as Partial<T>;
}
