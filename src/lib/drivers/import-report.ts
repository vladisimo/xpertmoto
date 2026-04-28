import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import type { DriverHeaderSanity } from "./import-parse";
import type { BatchValidationResult, SkipReason } from "./import-validate";

/**
 * JSON report written after every run (dry-run or real) so operators have a
 * paper trail of what the script did. Filename uses an ISO-8601 timestamp so
 * reports sort chronologically in the data/ folder.
 */
export interface DriverImportReport {
  timestamp: string;
  csvPath: string;
  imagesPath: string | null;
  dryRun: boolean;
  limit: number | null;
  skipImages: boolean;
  header: DriverHeaderSanity;
  totals: {
    rowsInCsv: number;
    validated: number;
    imported: number;
    updated: number;
    skipped: number;
    errored: number;
    imagesUploaded: number;
    imagesMissing: number;
    imagesUnknownPattern: number;
    imagesFailed: number;
  };
  imported: ImportedRowEntry[];
  skipped: SkippedRowEntry[];
  errored: ErroredRowEntry[];
  imageIssues: ImageIssueEntry[];
}

export interface ImportedRowEntry {
  rowNumber: number;
  legacyDriverId: string;
  email: string;
  userId: string | null;
  /** True if a new User was created, false if an existing one was updated. */
  created: boolean;
  imageCount: number;
}

export interface SkippedRowEntry {
  rowNumber: number;
  legacyDriverId: string | null;
  email: string | null;
  reason: SkipReason;
  note?: string;
}

export interface ErroredRowEntry {
  rowNumber: number;
  legacyDriverId: string | null;
  email: string | null;
  issues: string[];
}

export type ImageIssueReason =
  | "missing_on_disk"
  | "unknown_pattern"
  | "process_failed"
  | "upload_failed";

export interface ImageIssueEntry {
  legacyDriverId: string;
  filename: string;
  reason: ImageIssueReason;
  note?: string;
}

/**
 * Accumulator used while the import runs. Call the mutators from inside the
 * import loop, then `.build()` at the end to produce a final report.
 */
export class DriverImportReportBuilder {
  private readonly startedAt = new Date();
  private readonly imported: ImportedRowEntry[] = [];
  private readonly skipped: SkippedRowEntry[] = [];
  private readonly errored: ErroredRowEntry[] = [];
  private readonly imageIssues: ImageIssueEntry[] = [];
  private imagesUploaded = 0;

  constructor(
    private readonly meta: {
      csvPath: string;
      imagesPath: string | null;
      dryRun: boolean;
      limit: number | null;
      skipImages: boolean;
      header: DriverHeaderSanity;
      rowsInCsv: number;
      validatedRows: number;
    },
  ) {}

  /**
   * Seed the skipped/errored lists from the initial batch validation. Call
   * this once before the import loop starts.
   */
  addBatchValidation(batch: BatchValidationResult): void {
    for (const s of batch.skipped) {
      const entry: SkippedRowEntry = {
        rowNumber: s.rowNumber,
        legacyDriverId: s.legacyDriverId,
        email: s.email,
        reason: s.reason,
      };
      if (s.note !== undefined) entry.note = s.note;
      this.skipped.push(entry);
    }
    for (const e of batch.errored) {
      this.errored.push({
        rowNumber: e.rowNumber,
        legacyDriverId: e.legacyDriverId,
        email: e.email,
        issues: e.issues,
      });
    }
  }

  recordImported(entry: ImportedRowEntry): void {
    this.imported.push(entry);
  }

  recordFailure(entry: ErroredRowEntry): void {
    this.errored.push(entry);
  }

  recordImageUploaded(): void {
    this.imagesUploaded += 1;
  }

  recordImageIssue(entry: ImageIssueEntry): void {
    this.imageIssues.push(entry);
  }

  build(): DriverImportReport {
    const imagesMissing = this.imageIssues.filter((i) => i.reason === "missing_on_disk").length;
    const imagesUnknownPattern = this.imageIssues.filter(
      (i) => i.reason === "unknown_pattern",
    ).length;
    const imagesFailed = this.imageIssues.filter(
      (i) => i.reason === "process_failed" || i.reason === "upload_failed",
    ).length;

    return {
      timestamp: this.startedAt.toISOString(),
      csvPath: this.meta.csvPath,
      imagesPath: this.meta.imagesPath,
      dryRun: this.meta.dryRun,
      limit: this.meta.limit,
      skipImages: this.meta.skipImages,
      header: this.meta.header,
      totals: {
        rowsInCsv: this.meta.rowsInCsv,
        validated: this.meta.validatedRows,
        imported: this.imported.filter((i) => i.created).length,
        updated: this.imported.filter((i) => !i.created).length,
        skipped: this.skipped.length,
        errored: this.errored.length,
        imagesUploaded: this.imagesUploaded,
        imagesMissing,
        imagesUnknownPattern,
        imagesFailed,
      },
      imported: this.imported,
      skipped: this.skipped,
      errored: this.errored,
      imageIssues: this.imageIssues,
    };
  }
}

/**
 * Write the report to `data/driver-import-report-<ISO>.json`. The ISO
 * timestamp has colons replaced so the filename is safe on all platforms.
 * Returns the absolute file path.
 */
export function writeDriverImportReport(
  report: DriverImportReport,
  outputDir: string,
): string {
  mkdirSync(outputDir, { recursive: true });
  const safeStamp = report.timestamp.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  const filename = `driver-import-report-${safeStamp}.json`;
  const fullPath = path.join(outputDir, filename);
  writeFileSync(fullPath, JSON.stringify(report, null, 2), "utf-8");
  return fullPath;
}

/**
 * Short human-readable summary for the console — one line per totals row so
 * operators can eyeball the outcome without opening the JSON.
 */
export function formatReportSummary(report: DriverImportReport): string {
  const t = report.totals;
  const lines = [
    `Driver import ${report.dryRun ? "(DRY RUN)" : ""} — ${report.timestamp}`,
    `  CSV rows:         ${t.rowsInCsv}`,
    `  Validated:        ${t.validated}`,
    `  Imported (new):   ${t.imported}`,
    `  Updated:          ${t.updated}`,
    `  Skipped:          ${t.skipped}`,
    `  Errored:          ${t.errored}`,
  ];
  if (!report.skipImages) {
    lines.push(
      `  Images uploaded:  ${t.imagesUploaded}`,
      `  Images missing:   ${t.imagesMissing}`,
      `  Images unknown:   ${t.imagesUnknownPattern}`,
      `  Images failed:    ${t.imagesFailed}`,
    );
  }
  if (report.header.missing.length > 0) {
    lines.push(`  WARN missing required headers: ${report.header.missing.join(", ")}`);
  }
  if (report.header.unknown.length > 0) {
    lines.push(`  INFO unknown headers (ignored): ${report.header.unknown.join(", ")}`);
  }
  return lines.join("\n");
}
