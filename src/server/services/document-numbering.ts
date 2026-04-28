import { Prisma, type TaxDocumentType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getInvoicingConfig } from "@/lib/invoicing-config";

/**
 * Sequential per-financial-year document numbering for tax invoices,
 * adjustment notes, and branded payment receipts.
 *
 * Format: `<PREFIX>-<FY>-<NNNNNN>` (e.g. `INV-2026-000001`).
 *
 * `FY` is the Australian financial year that ends on 30 June. A document
 * issued on 14 March 2026 belongs to FY 2026; one issued on 1 July 2026
 * belongs to FY 2027.
 *
 * Concurrency: each call must run inside a transaction and uses
 * `SELECT ... FOR UPDATE` on the (documentType, financialYear) row of
 * `DocumentCounter`. Two parallel issuers will serialise on the row lock
 * and produce strictly monotonic numbers; uniqueness is additionally
 * defended by the `Invoice.invoiceNumber` / `AdjustmentNote.adjustmentNumber`
 * / `Payment.receiptNumber` unique indexes.
 */

const TIMEZONE = "Australia/Brisbane";

/** Australian FY ending 30 June. 14 March 2026 → 2026; 1 July 2026 → 2027. */
export function australianFinancialYear(date: Date): number {
  // Use Intl with a fixed AU timezone so behaviour is deterministic for
  // jobs running in UTC containers and for tests that fix `Date.now()`.
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "numeric",
  });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error(`document-numbering: could not parse FY from ${date.toISOString()}`);
  }
  return month >= 7 ? year + 1 : year;
}

interface NextNumberArgs {
  /** Required transaction client — issuance must be atomic with the consuming row insert. */
  tx: Prisma.TransactionClient;
  type: TaxDocumentType;
  /** Optional issue date; defaults to now. Lets backfill scripts produce FY-correct numbers. */
  issuedAt?: Date;
}

/**
 * Atomically increment the (type, FY) counter and return the formatted
 * document number. MUST be called inside the same transaction as the
 * row that will store it, so a rollback also rolls back the increment.
 */
export async function nextDocumentNumber({
  tx,
  type,
  issuedAt,
}: NextNumberArgs): Promise<string> {
  const date = issuedAt ?? new Date();
  const fy = australianFinancialYear(date);

  // SELECT ... FOR UPDATE on the counter row. Insert-on-conflict
  // semantics seed the row on the first issue of the FY without a
  // separate roundtrip. Using raw SQL because Prisma's `update` does
  // not expose row-level locking primitives.
  const rows = await tx.$queryRaw<{ nextValue: number }[]>(Prisma.sql`
    INSERT INTO "DocumentCounter" ("documentType", "financialYear", "nextValue", "updatedAt")
    VALUES (${type}::"TaxDocumentType", ${fy}, 2, NOW())
    ON CONFLICT ("documentType", "financialYear")
    DO UPDATE SET "nextValue" = "DocumentCounter"."nextValue" + 1, "updatedAt" = NOW()
    RETURNING "nextValue" - 1 AS "nextValue"
  `);

  const seq = rows[0]?.nextValue;
  if (typeof seq !== "number" || !Number.isFinite(seq)) {
    throw new Error(`document-numbering: failed to read next value for ${type}/${fy}`);
  }

  const cfg = await getInvoicingConfig();
  const prefix =
    type === "INVOICE"
      ? cfg.invoicePrefix
      : type === "ADJUSTMENT_NOTE"
        ? cfg.adjustmentPrefix
        : cfg.receiptPrefix;

  return `${prefix}-${fy}-${String(seq).padStart(6, "0")}`;
}

/**
 * Convenience wrapper for callers outside an existing transaction.
 * Opens a short transaction just to allocate a number. Prefer the
 * `nextDocumentNumber({ tx, ... })` form when issuing alongside
 * inserting the consuming row.
 */
export async function allocateDocumentNumber(
  type: TaxDocumentType,
  issuedAt?: Date,
): Promise<string> {
  return prisma.$transaction((tx) => nextDocumentNumber({ tx, type, issuedAt }));
}
