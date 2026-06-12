import type { Prisma, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  CUSTOMER_IMPORT_COLUMNS,
  customerImportRowSchema,
  type CustomerImportRow,
  type CustomerImportColumnKey,
} from "@/lib/validators/customer-import";

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const MAX_IMPORT_ROWS = 2000;

/** Rows per createMany statement. The profile insert binds ~22 params per
 *  row, so 500 keeps each statement comfortably under Postgres's 65535
 *  bind-parameter ceiling while still cutting 2000 rows to 4 round trips. */
const CREATE_CHUNK_SIZE = 500;

export type RawRow = Record<string, unknown>;

export type RowResult =
  | {
      rowIndex: number;
      status: "valid";
      email: string;
      name: string;
      data: CustomerImportRow;
    }
  | {
      rowIndex: number;
      status: "duplicate";
      email: string;
      name: string;
    }
  | {
      rowIndex: number;
      status: "error";
      email: string | null;
      name: string | null;
      errors: string[];
    };

export type ImportSummary = {
  totalRows: number;
  validRows: number;
  skippedDuplicates: number;
  errorRows: number;
  rows: RowResult[];
};

/**
 * Parse an uploaded .xlsx / .csv buffer into raw row objects keyed by the
 * column headers in the first sheet. Unknown columns are ignored; missing
 * columns surface as undefined and are caught by the row validator.
 */
export function parseCustomerImportFile(buffer: Buffer | ArrayBuffer): RawRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  // defval: "" makes every expected column present on every row so row-index
  // numbering matches what the user sees in Excel.
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: true });
  return rows;
}

function normaliseForSchema(raw: RawRow): RawRow {
  const out: RawRow = {};
  for (const col of CUSTOMER_IMPORT_COLUMNS) {
    out[col.key] = raw[col.header] ?? raw[col.key];
  }
  return out;
}

function isRowEmpty(raw: RawRow): boolean {
  for (const col of CUSTOMER_IMPORT_COLUMNS) {
    const v = raw[col.header] ?? raw[col.key];
    if (v !== null && v !== undefined && String(v).trim() !== "") return false;
  }
  return true;
}

/**
 * Validate every row in-memory, then cross-check the surviving emails
 * against the database in a single `findMany` batched lookup. Returns a
 * structured summary that the UI renders as a dry-run preview — no writes.
 */
export async function classifyRows(
  rawRows: RawRow[],
  db: PrismaLike,
): Promise<ImportSummary> {
  const rows: RowResult[] = [];
  const validByEmail = new Map<string, { rowIndex: number; data: CustomerImportRow }>();

  rawRows.forEach((raw, idx) => {
    // Row 1 in the XLSX is the header; first data row is Excel row 2.
    const rowIndex = idx + 2;
    if (isRowEmpty(raw)) return;

    const parsed = customerImportRowSchema.safeParse(normaliseForSchema(raw));
    if (!parsed.success) {
      const errors = parsed.error.issues.map((iss) => {
        const field = iss.path.join(".") || "row";
        return `${field}: ${iss.message}`;
      });
      const email = typeof raw.email === "string" ? raw.email.trim() : null;
      const fn = typeof raw.firstName === "string" ? raw.firstName.trim() : "";
      const ln = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
      const name = `${fn} ${ln}`.trim() || null;
      rows.push({ rowIndex, status: "error", email, name, errors });
      return;
    }

    const data = parsed.data;
    const email = data.email;
    // In-file duplicate: later occurrence is marked as error so we don't
    // silently import only one of them.
    if (validByEmail.has(email)) {
      rows.push({
        rowIndex,
        status: "error",
        email,
        name: `${data.firstName} ${data.lastName}`,
        errors: [`email: duplicate of row ${validByEmail.get(email)!.rowIndex} in this file`],
      });
      return;
    }

    validByEmail.set(email, { rowIndex, data });
    rows.push({
      rowIndex,
      status: "valid",
      email,
      name: `${data.firstName} ${data.lastName}`,
      data,
    });
  });

  const candidateEmails = Array.from(validByEmail.keys());
  const existing =
    candidateEmails.length === 0
      ? []
      : await db.user.findMany({
          where: { email: { in: candidateEmails } },
          select: { email: true },
        });
  const existingSet = new Set(existing.map((u) => u.email));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.status === "valid" && existingSet.has(r.email)) {
      rows[i] = {
        rowIndex: r.rowIndex,
        status: "duplicate",
        email: r.email,
        name: r.name,
      };
    }
  }

  const validRows = rows.filter((r) => r.status === "valid").length;
  const skippedDuplicates = rows.filter((r) => r.status === "duplicate").length;
  const errorRows = rows.filter((r) => r.status === "error").length;

  return {
    totalRows: rows.length,
    validRows,
    skippedDuplicates,
    errorRows,
    rows,
  };
}

/**
 * Write every valid row inside a single transaction. Duplicate-email rows
 * and error rows are not attempted — the caller supplies the pre-classified
 * summary.
 */
export async function commitImport(
  summary: ImportSummary,
  db: PrismaLike,
): Promise<{ inserted: number; skipped: number }> {
  const validRows = summary.rows.filter(
    (r): r is Extract<RowResult, { status: "valid" }> => r.status === "valid",
  );
  if (validRows.length === 0) {
    return { inserted: 0, skipped: summary.skippedDuplicates };
  }

  // Re-check duplicates just before the write in case a concurrent staff
  // member created the email since the dry-run.
  const emails = validRows.map((r) => r.data.email);
  const taken = new Set(
    (
      await db.user.findMany({
        where: { email: { in: emails } },
        select: { email: true },
      })
    ).map((u) => u.email),
  );

  // Batched inserts: users then profiles via chunked createMany, instead of
  // up to MAX_IMPORT_ROWS serial nested creates (2 round trips per row).
  // createMany can't do nested writes, so the user ids are read back by
  // email between the two passes. skipDuplicates + the returned count keep
  // the totals honest if a concurrent insert sneaks past the re-check.
  const toInsert = validRows.filter((r) => !taken.has(r.data.email));
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CREATE_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CREATE_CHUNK_SIZE);
    const createdUsers = await db.user.createMany({
      data: chunk.map(({ data: d }) => ({
        email: d.email,
        firstName: d.firstName,
        lastName: d.lastName,
        phone: d.phone,
        dateOfBirth: d.dateOfBirth,
        role: "CUSTOMER" as const,
      })),
      skipDuplicates: true,
    });
    inserted += createdUsers.count;

    const ids = await db.user.findMany({
      where: { email: { in: chunk.map((r) => r.data.email) } },
      select: { id: true, email: true },
    });
    const idByEmail = new Map(ids.map((u) => [u.email, u.id]));
    await db.customerProfile.createMany({
      data: chunk.flatMap(({ data: d }) => {
        const userId = idByEmail.get(d.email);
        if (!userId) return [];
        return [
          {
            userId,
            licenceNumber: d.licenceNumber,
            licenceState: d.licenceState,
            licenceExpiry: d.licenceExpiry,
            licenceClass: d.licenceClass,
            passportNumber: d.passportNumber,
            passportCountry: d.passportCountry,
            passportExpiry: d.passportExpiry,
            emergencyContactName: d.emergencyContactName,
            emergencyContactPhone: d.emergencyContactPhone,
            emergencyContactRelationship: d.emergencyContactRelationship,
            addressLine1: d.addressLine1,
            addressLine2: d.addressLine2,
            suburb: d.suburb,
            state: d.state,
            postcode: d.postcode,
            country: d.country ?? "Australia",
            marketingOptIn: d.marketingOptIn ?? false,
            marketingSmsOptIn: d.marketingSmsOptIn ?? false,
            notes: d.notes,
            riskRating: d.riskRating ?? "LOW",
            loyaltyTier: d.loyaltyTier ?? "SILVER",
          },
        ];
      }),
      skipDuplicates: true,
    });
  }

  return {
    inserted,
    skipped: summary.skippedDuplicates + (validRows.length - inserted),
  };
}

/**
 * Build an Instructions-sheet payload describing which columns are
 * required and the accepted enum values. Used by the export route when
 * generating the blank template.
 */
export const CUSTOMER_IMPORT_INSTRUCTIONS: Array<[string, string]> = [
  ["Column", "Guidance"],
  ["email *", "Required. Must be unique. Duplicate emails are skipped."],
  ["firstName *", "Required."],
  ["lastName *", "Required."],
  ["phone", "Optional. Digits, spaces, +, -, (), length 8–15."],
  ["dateOfBirth", "Optional. YYYY-MM-DD."],
  ["licenceNumber", "Optional."],
  ["licenceState", "Optional. One of: QLD, NSW, VIC, TAS, SA, WA, NT, ACT."],
  ["licenceExpiry", "Optional. YYYY-MM-DD."],
  ["licenceClass", "Optional. e.g. RE, R, C."],
  ["passportNumber", "Optional — international customers."],
  ["passportCountry", "Optional."],
  ["passportExpiry", "Optional. YYYY-MM-DD."],
  ["emergencyContactName", "Optional."],
  ["emergencyContactPhone", "Optional. Same format as phone."],
  ["emergencyContactRelationship", "Optional."],
  ["addressLine1", "Optional."],
  ["addressLine2", "Optional."],
  ["suburb", "Optional."],
  ["state", "Optional. One of: QLD, NSW, VIC, TAS, SA, WA, NT, ACT."],
  ["postcode", "Optional. 4 digits."],
  ["country", "Optional. Defaults to Australia."],
  ["marketingOptIn", "Optional. true / false."],
  ["marketingSmsOptIn", "Optional. true / false."],
  ["notes", "Optional. Freeform."],
  ["riskRating", "Optional. LOW (default) / MEDIUM / HIGH."],
  ["loyaltyTier", "Optional. SILVER (default) / GOLD / PLATINUM."],
  ["", ""],
  ["Photos & documents", "Upload licence/passport images per-customer after import."],
  [
    "Duplicates",
    "Rows whose email matches an existing customer are skipped with a warning.",
  ],
  [
    "Errors",
    "Rows failing validation are skipped; the other rows still import.",
  ],
];

export const CUSTOMER_IMPORT_HEADER_KEYS: CustomerImportColumnKey[] =
  CUSTOMER_IMPORT_COLUMNS.map((c) => c.key);
