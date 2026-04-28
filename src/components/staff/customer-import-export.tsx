"use client";

import * as React from "react";
import { AlertCircle, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/layout/page-section";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type RowStatus = "valid" | "duplicate" | "error";

interface SummaryRow {
  rowIndex: number;
  status: RowStatus;
  email: string | null;
  name: string | null;
  errors?: string[];
}

interface ImportSummary {
  totalRows: number;
  validRows: number;
  skippedDuplicates: number;
  errorRows: number;
  rows: SummaryRow[];
}

const STATUS_KEY: Record<RowStatus, { key: StatusKey; label: string }> = {
  valid: { key: "READY", label: "Valid" },
  duplicate: { key: "DUPLICATE", label: "Duplicate" },
  error: { key: "ERROR", label: "Error" },
};

function StatCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-primary"
      : tone === "danger"
      ? "text-destructive"
      : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className={cn("mt-2 font-display text-3xl font-semibold tabular-nums", toneClass)}>
        {value.toLocaleString("en-AU")}
      </div>
    </div>
  );
}

function buildErrorCsv(summary: ImportSummary): string {
  const header = ["rowIndex", "email", "name", "errors"];
  const esc = (v: string | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of summary.rows) {
    if (r.status !== "error") continue;
    lines.push(
      [esc(String(r.rowIndex)), esc(r.email), esc(r.name), esc((r.errors ?? []).join("; "))].join(","),
    );
  }
  return lines.join("\n");
}

function downloadTextFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CustomerImportExportTab() {
  const utils = trpc.useUtils();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);
  const [isCommitting, setIsCommitting] = React.useState(false);
  const [commitResult, setCommitResult] = React.useState<{ inserted: number; skipped: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const reset = React.useCallback(() => {
    setFile(null);
    setSummary(null);
    setError(null);
    setCommitResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const validate = React.useCallback(async (f: File) => {
    setIsValidating(true);
    setError(null);
    setSummary(null);
    setCommitResult(null);
    try {
      const body = new FormData();
      body.append("file", f);
      body.append("mode", "validate");
      const res = await fetch("/api/staff/customers/import", { method: "POST", body });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError((json as { error?: string }).error ?? `Validation failed (${res.status})`);
        return;
      }
      setSummary((json as { summary: ImportSummary }).summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setIsValidating(false);
    }
  }, []);

  const handleFile = React.useCallback(
    (f: File | null) => {
      setFile(f);
      setSummary(null);
      setCommitResult(null);
      setError(null);
      if (f) void validate(f);
    },
    [validate],
  );

  const commit = React.useCallback(async () => {
    if (!file || !summary || summary.validRows === 0) return;
    setIsCommitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("mode", "commit");
      const res = await fetch("/api/staff/customers/import", { method: "POST", body });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError((json as { error?: string }).error ?? `Import failed (${res.status})`);
        return;
      }
      const result = json as {
        inserted: number;
        skipped: number;
        summary: ImportSummary;
      };
      setCommitResult({ inserted: result.inserted, skipped: result.skipped });
      setSummary(result.summary);
      await Promise.all([
        utils.staffCustomer.list.invalidate(),
        utils.staffCustomer.stats.invalidate(),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setIsCommitting(false);
    }
  }, [file, summary, utils]);

  const rowColumns: DataTableColumn<SummaryRow>[] = React.useMemo(
    () => [
      {
        id: "rowIndex",
        header: "Row",
        cell: (r) => <span className="font-mono tabular-nums">{r.rowIndex}</span>,
        width: "4rem",
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => {
          const s = STATUS_KEY[r.status];
          return <StatusBadge status={s.key} label={s.label} />;
        },
        width: "8rem",
      },
      {
        id: "email",
        header: "Email",
        cell: (r) => r.email ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "name",
        header: "Name",
        cell: (r) => r.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "reason",
        header: "Reason",
        cell: (r) => {
          if (r.status === "duplicate") {
            return <span className="text-muted-foreground">Email already exists — will be skipped.</span>;
          }
          if (r.status === "error") {
            return (
              <ul className="list-inside list-disc text-sm text-destructive">
                {(r.errors ?? []).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            );
          }
          return <span className="text-muted-foreground">Ready to import.</span>;
        },
      },
    ],
    [],
  );

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div className="space-y-6">
      <PageSection
        title="Export"
        description="Download the current customer list or a blank template. Exported files are shaped for re-import."
      >
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" asChild>
            <a href="/api/staff/customers/export?mode=template" download>
              <FileSpreadsheet className="h-4 w-4" />
              Download blank template
            </a>
          </Button>
          <Button variant="secondary" asChild>
            <a href="/api/staff/customers/export?mode=all" download>
              <Download className="h-4 w-4" />
              Export all customers
            </a>
          </Button>
        </div>
      </PageSection>

      <PageSection
        title="Import"
        description="Upload an .xlsx (or .csv) to bulk-add customers. We validate the file first — nothing is written until you confirm."
      >
        <label
          htmlFor="customer-import-file"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background px-6 py-10 text-center transition-colors hover:border-primary/60 hover:bg-muted/30",
            isDragging && "border-primary bg-primary/5",
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
          <div className="text-sm font-medium text-foreground">
            {file ? file.name : "Drop a spreadsheet here or click to browse"}
          </div>
          <div className="text-xs text-muted-foreground">
            Accepts .xlsx, .xls, .csv · max 8MB
          </div>
          <input
            id="customer-import-file"
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              handleFile(f);
            }}
          />
        </label>

        {file && (
          <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="font-medium text-foreground">{file.name}</span>
              <span className="text-muted-foreground">
                {(file.size / 1024).toLocaleString("en-AU", { maximumFractionDigits: 1 })} KB
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={reset} disabled={isValidating || isCommitting}>
              <X className="h-4 w-4" />
              Clear
            </Button>
          </div>
        )}

        {isValidating && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Validating spreadsheet…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>{error}</div>
          </div>
        )}

        {summary && !error && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard title="Total rows" value={summary.totalRows} tone="neutral" />
              <StatCard title="Valid" value={summary.validRows} tone="success" />
              <StatCard title="Duplicates" value={summary.skippedDuplicates} tone="warning" />
              <StatCard title="Errors" value={summary.errorRows} tone="danger" />
            </div>

            {commitResult ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm text-foreground">
                <div>
                  Imported <strong>{commitResult.inserted}</strong> customer
                  {commitResult.inserted === 1 ? "" : "s"}.{" "}
                  {commitResult.skipped > 0 && (
                    <>Skipped {commitResult.skipped} (duplicates or invalid).</>
                  )}
                </div>
                <Button variant="secondary" size="sm" onClick={reset}>
                  Import another file
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {summary.validRows > 0
                    ? `Ready to import ${summary.validRows} new customer${summary.validRows === 1 ? "" : "s"}.`
                    : "No new customers to import."}
                </div>
                <div className="flex gap-2">
                  {summary.errorRows > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        downloadTextFile(
                          buildErrorCsv(summary),
                          `customer-import-errors-${new Date().toISOString().slice(0, 10)}.csv`,
                          "text/csv",
                        )
                      }
                    >
                      <Download className="h-4 w-4" />
                      Download error report
                    </Button>
                  )}
                  <Button
                    onClick={commit}
                    disabled={summary.validRows === 0 || isCommitting}
                  >
                    {isCommitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Importing…
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Import {summary.validRows} valid customer
                        {summary.validRows === 1 ? "" : "s"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-md border">
              <DataTable
                columns={rowColumns}
                data={summary.rows}
                getRowId={(r) => String(r.rowIndex)}
                empty={
                  <span className="text-muted-foreground">
                    The spreadsheet had no data rows.
                  </span>
                }
              />
            </div>
          </div>
        )}
      </PageSection>
    </div>
  );
}
