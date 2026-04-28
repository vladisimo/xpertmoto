import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DriverImportReportBuilder,
  formatReportSummary,
  writeDriverImportReport,
} from "@/lib/drivers/import-report";
import type { BatchValidationResult } from "@/lib/drivers/import-validate";

function makeBuilder(): DriverImportReportBuilder {
  return new DriverImportReportBuilder({
    csvPath: "/tmp/drivers.csv",
    imagesPath: "/tmp/driver-images",
    dryRun: true,
    limit: null,
    skipImages: false,
    header: { missing: [], unknown: [] },
    rowsInCsv: 10,
    validatedRows: 8,
  });
}

function emptyBatch(): BatchValidationResult {
  return { ok: [], skipped: [], errored: [] };
}

describe("DriverImportReportBuilder", () => {
  test("totals sum across imported / updated / skipped / errored", () => {
    const b = makeBuilder();
    b.addBatchValidation({
      ...emptyBatch(),
      skipped: [
        { rowNumber: 3, legacyDriverId: "3", email: "a@a.com", reason: "duplicate_email_older_row" },
      ],
      errored: [
        { rowNumber: 4, legacyDriverId: null, email: null, issues: ["missing name"] },
      ],
    });
    b.recordImported({
      rowNumber: 2,
      legacyDriverId: "1",
      email: "new@a.com",
      userId: "u1",
      created: true,
      imageCount: 2,
    });
    b.recordImported({
      rowNumber: 5,
      legacyDriverId: "2",
      email: "upd@a.com",
      userId: "u2",
      created: false,
      imageCount: 0,
    });
    b.recordImageUploaded();
    b.recordImageUploaded();
    b.recordImageIssue({
      legacyDriverId: "1",
      filename: "1_mystery.png",
      reason: "unknown_pattern",
    });
    b.recordImageIssue({
      legacyDriverId: "1",
      filename: "1_license_front.jpg",
      reason: "missing_on_disk",
    });

    const report = b.build();
    expect(report.totals).toMatchObject({
      rowsInCsv: 10,
      validated: 8,
      imported: 1,
      updated: 1,
      skipped: 1,
      errored: 1,
      imagesUploaded: 2,
      imagesMissing: 1,
      imagesUnknownPattern: 1,
      imagesFailed: 0,
    });
    expect(report.imported).toHaveLength(2);
    expect(report.skipped).toHaveLength(1);
    expect(report.errored).toHaveLength(1);
    expect(report.imageIssues).toHaveLength(2);
  });

  test("failure reasons are bucketed separately from missing", () => {
    const b = makeBuilder();
    b.recordImageIssue({ legacyDriverId: "1", filename: "x.png", reason: "upload_failed" });
    b.recordImageIssue({ legacyDriverId: "1", filename: "y.png", reason: "process_failed" });
    const report = b.build();
    expect(report.totals.imagesFailed).toBe(2);
    expect(report.totals.imagesMissing).toBe(0);
  });
});

describe("writeDriverImportReport", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "driver-report-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes file with ISO timestamp (colons stripped) and returns path", () => {
    const b = makeBuilder();
    const report = b.build();
    const out = writeDriverImportReport(report, dir);

    expect(out.startsWith(dir)).toBe(true);
    const basename = path.basename(out);
    expect(basename.startsWith("driver-import-report-")).toBe(true);
    expect(basename.endsWith(".json")).toBe(true);
    // No colons in filename (would be invalid on Windows, ugly everywhere).
    expect(basename).not.toContain(":");

    const round = JSON.parse(readFileSync(out, "utf-8"));
    expect(round.csvPath).toBe(report.csvPath);
    expect(round.totals).toEqual(report.totals);
  });
});

describe("formatReportSummary", () => {
  test("includes image lines only when images weren't skipped", () => {
    const report = makeBuilder().build();
    expect(formatReportSummary(report)).toContain("Images uploaded:");

    const skipImages = new DriverImportReportBuilder({
      csvPath: "x",
      imagesPath: null,
      dryRun: false,
      limit: null,
      skipImages: true,
      header: { missing: [], unknown: [] },
      rowsInCsv: 0,
      validatedRows: 0,
    }).build();
    expect(formatReportSummary(skipImages)).not.toContain("Images uploaded:");
  });

  test("surfaces header warnings when required columns missing", () => {
    const report = new DriverImportReportBuilder({
      csvPath: "x",
      imagesPath: null,
      dryRun: true,
      limit: null,
      skipImages: true,
      header: { missing: ["email"], unknown: ["mystery_col"] },
      rowsInCsv: 0,
      validatedRows: 0,
    }).build();
    const summary = formatReportSummary(report);
    expect(summary).toContain("missing required headers: email");
    expect(summary).toContain("unknown headers (ignored): mystery_col");
  });
});
