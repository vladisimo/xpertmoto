import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import type { ColumnDef, ExportMeta } from "./index";
import { DEFAULT_BRAND, computeFooterRow, formatCell } from "./index";

const PDF_ACCENT = "#0F172A";
const ALT_ROW = "#f9f9f7";
const BORDER = "#ddd";
const MUTED = "#666";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  pageLandscape: { padding: 32, fontSize: 8, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 3,
    borderBottomColor: PDF_ACCENT,
    paddingBottom: 8,
    marginBottom: 12,
  },
  brand: { fontSize: 20, fontWeight: 700, color: PDF_ACCENT },
  abn: { fontSize: 8, color: MUTED, marginTop: 2 },
  metaRight: { textAlign: "right", fontSize: 9, color: "#333" },
  metaTitle: { fontSize: 11, fontWeight: 700, color: PDF_ACCENT },
  filterSummary: { marginBottom: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterItem: { fontSize: 8 },
  filterLabel: { color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  filterValue: { fontWeight: 700 },
  tableHeader: { flexDirection: "row", backgroundColor: PDF_ACCENT, paddingVertical: 5 },
  tableHeaderCell: { color: "#fff", fontWeight: 700, fontSize: 8, paddingHorizontal: 4 },
  tableRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  tableRowAlt: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: BORDER, backgroundColor: ALT_ROW },
  tableCell: { fontSize: 8, paddingHorizontal: 4 },
  totalsRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderTopWidth: 2,
    borderTopColor: PDF_ACCENT,
    marginTop: 2,
  },
  totalsCell: { fontSize: 8, fontWeight: 700, paddingHorizontal: 4 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    fontSize: 7,
    color: MUTED,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function cellAlign<T>(col: ColumnDef<T>): "left" | "right" | "center" {
  if (col.align) return col.align;
  if (col.format === "currency" || col.format === "number" || col.format === "percent") return "right";
  return "left";
}

export interface ReportPdfConfig<T> {
  meta: ExportMeta;
  columns: ColumnDef<T>[];
  rows: T[];
}

function ReportPdf<T>({ meta, columns, rows }: ReportPdfConfig<T>) {
  const landscape = columns.length > 8;
  const pageStyle = landscape ? styles.pageLandscape : styles.page;
  const colFlex = columns.map((c) => c.width ?? 1);

  const footer = computeFooterRow(rows, columns);

  return createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "A4", orientation: landscape ? "landscape" : "portrait", style: pageStyle, wrap: true },
      createElement(
        View,
        { style: styles.header, fixed: true },
        createElement(
          View,
          null,
          createElement(Text, { style: styles.brand }, meta.brand.name),
          createElement(Text, { style: styles.abn }, `${meta.brand.name} Pty Ltd · ABN ${meta.brand.abn}`),
        ),
        createElement(
          View,
          { style: styles.metaRight },
          createElement(Text, { style: styles.metaTitle }, meta.title),
          meta.subtitle ? createElement(Text, null, meta.subtitle) : null,
          createElement(Text, null, `Generated ${meta.generatedAt.toLocaleString("en-AU")}`),
        ),
      ),

      meta.filters.length > 0
        ? createElement(
            View,
            { style: styles.filterSummary },
            ...meta.filters.map((f, i) =>
              createElement(
                View,
                { key: i, style: styles.filterItem },
                createElement(Text, { style: styles.filterLabel }, f.label),
                createElement(Text, { style: styles.filterValue }, f.value),
              ),
            ),
          )
        : null,

      createElement(
        View,
        { style: styles.tableHeader, fixed: true },
        ...columns.map((col, i) =>
          createElement(
            Text,
            {
              key: col.key,
              style: [styles.tableHeaderCell, { flex: colFlex[i] ?? 1, textAlign: cellAlign(col) }],
            },
            col.header,
          ),
        ),
      ),

      ...rows.map((row, r) =>
        createElement(
          View,
          { key: r, style: r % 2 === 0 ? styles.tableRow : styles.tableRowAlt, wrap: false },
          ...columns.map((col, i) =>
            createElement(
              Text,
              {
                key: col.key,
                style: [styles.tableCell, { flex: colFlex[i] ?? 1, textAlign: cellAlign(col) }],
              },
              formatCell(row[col.key], col.format),
            ),
          ),
        ),
      ),

      footer
        ? createElement(
            View,
            { style: styles.totalsRow, wrap: false },
            ...columns.map((col, i) => {
              const v = (footer as Record<string, unknown>)[col.key];
              const isFirst = i === 0;
              const display =
                v !== undefined
                  ? formatCell(v, col.format)
                  : isFirst
                    ? "Total"
                    : "";
              return createElement(
                Text,
                {
                  key: col.key,
                  style: [styles.totalsCell, { flex: colFlex[i] ?? 1, textAlign: cellAlign(col) }],
                },
                display,
              );
            }),
          )
        : null,

      createElement(
        View,
        { style: styles.footer, fixed: true },
        createElement(Text, null, `${meta.brand.email} · ${meta.brand.website}`),
        createElement(Text, {
          render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `${pageNumber} / ${totalPages}`,
        }),
      ),
    ),
  );
}

export async function toPdfBuffer<T>(config: ReportPdfConfig<T>): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = createElement(ReportPdf, config as any) as any;
  return renderToBuffer(el);
}

export function defaultMeta(overrides: Partial<ExportMeta>): ExportMeta {
  return {
    title: "Report",
    generatedAt: new Date(),
    filters: [],
    brand: DEFAULT_BRAND,
    ...overrides,
  };
}

export { ReportPdf };
