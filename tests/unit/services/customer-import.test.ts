import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  classifyRows,
  commitImport,
  parseCustomerImportFile,
  type ImportSummary,
  type PrismaLike,
  type RawRow,
} from "../../../src/server/services/customer-import";
import { CUSTOMER_IMPORT_COLUMNS } from "../../../src/lib/validators/customer-import";

function mkDb(existingEmails: string[] = []) {
  const existing = new Set(existingEmails);
  const createdUsers: Array<Record<string, unknown>> = [];
  const findMany = vi.fn(async (args: { where: { email: { in: string[] } } }) => {
    return args.where.email.in
      .filter((e) => existing.has(e))
      .map((email) => ({ email }));
  });
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    const email = args.data.email as string;
    existing.add(email);
    createdUsers.push(args.data);
    return { id: `u_${createdUsers.length}`, ...args.data };
  });
  const db = {
    user: { findMany, create },
  } as unknown as PrismaLike;
  return { db, findMany, create, createdUsers };
}

function buildXlsx(rows: RawRow[]): Buffer {
  const headers = CUSTOMER_IMPORT_COLUMNS.map((c) => c.header);
  const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Customers");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
}

describe("customer-import classifyRows", () => {
  it("accepts a minimal valid row", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [{ email: "ana@example.com", firstName: "Ana", lastName: "Brown" }],
      db,
    );
    expect(summary.totalRows).toBe(1);
    expect(summary.validRows).toBe(1);
    expect(summary.errorRows).toBe(0);
    expect(summary.skippedDuplicates).toBe(0);
  });

  it("flags missing email as an error but keeps processing other rows", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [
        { email: "", firstName: "No", lastName: "Email" },
        { email: "ok@example.com", firstName: "OK", lastName: "Row" },
      ],
      db,
    );
    expect(summary.validRows).toBe(1);
    expect(summary.errorRows).toBe(1);
    const err = summary.rows.find((r) => r.status === "error")!;
    expect(err.errors?.some((m) => m.includes("email"))).toBe(true);
  });

  it("rejects malformed emails", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [{ email: "not-an-email", firstName: "x", lastName: "y" }],
      db,
    );
    expect(summary.errorRows).toBe(1);
  });

  it("rejects an unknown licence state", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [
        {
          email: "zz@example.com",
          firstName: "Zoe",
          lastName: "Zed",
          licenceState: "ZZ",
        },
      ],
      db,
    );
    expect(summary.errorRows).toBe(1);
    const err = summary.rows[0]!;
    expect(err.status).toBe("error");
    if (err.status === "error") {
      expect(err.errors.some((m) => m.includes("licenceState"))).toBe(true);
    }
  });

  it("marks existing emails as duplicate (not error)", async () => {
    const { db } = mkDb(["known@example.com"]);
    const summary = await classifyRows(
      [
        { email: "known@example.com", firstName: "Kay", lastName: "Known" },
        { email: "fresh@example.com", firstName: "Fran", lastName: "Fresh" },
      ],
      db,
    );
    expect(summary.skippedDuplicates).toBe(1);
    expect(summary.validRows).toBe(1);
    expect(summary.errorRows).toBe(0);
  });

  it("flags in-file duplicate emails as errors on the later row", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [
        { email: "same@example.com", firstName: "A", lastName: "First" },
        { email: "same@example.com", firstName: "B", lastName: "Second" },
      ],
      db,
    );
    expect(summary.validRows).toBe(1);
    expect(summary.errorRows).toBe(1);
    const err = summary.rows.find((r) => r.status === "error")!;
    expect(err.rowIndex).toBe(3); // header=row1, first data=row2, dup=row3
  });

  it("coerces boolean-ish marketing flags", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [
        {
          email: "opt@example.com",
          firstName: "Op",
          lastName: "Tin",
          marketingOptIn: "yes",
          marketingSmsOptIn: "no",
        },
      ],
      db,
    );
    expect(summary.validRows).toBe(1);
    const row = summary.rows[0]!;
    expect(row.status).toBe("valid");
    if (row.status === "valid") {
      expect(row.data.marketingOptIn).toBe(true);
      expect(row.data.marketingSmsOptIn).toBe(false);
    }
  });

  it("rejects malformed dates", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [
        {
          email: "d@example.com",
          firstName: "D",
          lastName: "Ob",
          dateOfBirth: "31/31/1999",
        },
      ],
      db,
    );
    expect(summary.errorRows).toBe(1);
  });

  it("skips blank rows silently", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [{ email: "", firstName: "", lastName: "" }],
      db,
    );
    expect(summary.totalRows).toBe(0);
  });

  it("uppercases state enums from mixed case input", async () => {
    const { db } = mkDb();
    const summary = await classifyRows(
      [
        {
          email: "s@example.com",
          firstName: "S",
          lastName: "Tate",
          state: "qld",
          licenceState: "nsw",
        },
      ],
      db,
    );
    expect(summary.validRows).toBe(1);
    const row = summary.rows[0]!;
    if (row.status === "valid") {
      expect(row.data.state).toBe("QLD");
      expect(row.data.licenceState).toBe("NSW");
    }
  });
});

describe("customer-import parseCustomerImportFile", () => {
  it("round-trips headers + values from a generated xlsx", () => {
    const buf = buildXlsx([
      { email: "r@example.com", firstName: "Round", lastName: "Trip", phone: "0412 345 678" },
    ]);
    const rows = parseCustomerImportFile(buf);
    expect(rows.length).toBe(1);
    expect(rows[0]!.email).toBe("r@example.com");
    expect(rows[0]!.firstName).toBe("Round");
  });
});

describe("customer-import commitImport", () => {
  it("creates a user per valid row and skips duplicates", async () => {
    const { db, create } = mkDb(["already@example.com"]);
    const summary = await classifyRows(
      [
        { email: "new@example.com", firstName: "New", lastName: "Guy" },
        { email: "already@example.com", firstName: "Dup", lastName: "E" },
      ],
      db,
    );
    const result = await commitImport(summary, db);
    expect(result.inserted).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    const createdArg = create.mock.calls[0]![0] as { data: { email: string } };
    expect(createdArg.data.email).toBe("new@example.com");
  });

  it("re-checks DB existence and skips rows claimed by a concurrent writer", async () => {
    const { db, create } = mkDb();
    // Dry-run says 1 valid.
    const summary: ImportSummary = await classifyRows(
      [{ email: "race@example.com", firstName: "Ra", lastName: "Ce" }],
      db,
    );
    expect(summary.validRows).toBe(1);

    // Simulate: between validate and commit, another staff member created the user.
    (db as unknown as { user: { findMany: (args: unknown) => Promise<Array<{ email: string }>> } }).user.findMany = vi.fn(
      async () => [{ email: "race@example.com" }],
    );

    const result = await commitImport(summary, db);
    expect(result.inserted).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns zero inserts when no valid rows", async () => {
    const { db, create } = mkDb();
    const summary = await classifyRows(
      [{ email: "", firstName: "", lastName: "" }],
      db,
    );
    const result = await commitImport(summary, db);
    expect(result.inserted).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
