/**
 * Linkt (Transurban) toll integration service.
 *
 * Linkt is a single Transurban account spanning NSW/VIC/QLD toll roads.
 * XPERT Moto's fleet tolls run through this provider, replacing the legacy
 * NSW e-toll account. This module is a first-class parity port of
 * `src/server/services/etoll.ts`:
 *
 *   parse the uploaded export file → normalised trip rows →
 *   match each trip to the vehicle + active booking → raise an idempotent
 *   TOLL Infringement (charged via applyInfringementRecoveryCharge), or
 *   capture the trip in LinktUnmatchedRow for staff reconciliation.
 *
 * Data acquisition: Linkt has no public API or pollable feed, and its portal
 * sits behind Imperva Incapsula bot-mitigation that blocks headless browsers.
 * So new trips enter via the official commercial CSV/Excel export, which a
 * staff member downloads from the portal and uploads — `runLinktSync` takes
 * that file as a Buffer. Everything downstream (parse → match → upsert) is
 * source-agnostic; a future Linkt for Business feed would only change how the
 * buffer is obtained.
 *
 * PROVISIONAL: the column headers / date format / sign convention in
 * `parseLinktExport` are best-effort and should be reconciled against a real
 * sample export the first time one is uploaded.
 */
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { Prisma, type LinktAccount, type PrismaClient } from "@prisma/client";

export type LinktTripRow = {
  externalHash: string; // sha256(accountId|plate|iso|cents|tollpoint) — idempotency key
  eventAt: Date;
  plate: string;
  tollpoint: string;
  amountCents: number; // positive cents
  rawDetails: string;
};

// ---------------------------------------------------------------------------
// Parse (source-agnostic — CSV or XLSX → normalised rows)
// ---------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

// Decompression-bomb guard for XLSX uploads. The route caps the *compressed*
// upload at 8 MB, but a zip bomb expands far beyond that in memory. Before
// handing the buffer to XLSX.read we sum the uncompressed sizes declared in
// the ZIP central directory and reject anything implausibly large for a toll
// export (a year of trips is well under 10 MB uncompressed). A crafted
// archive can still under-declare, so XLSX.read is additionally bounded with
// `sheetRows`; uploads are staff-only, so this targets accidents and casual
// abuse rather than a determined insider.
const MAX_DECLARED_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_SHEET_ROWS = 100_000;

function declaredZipUncompressedBytes(buf: Buffer): number | null {
  const EOCD_SIG = 0x06054b50;
  const CDIR_SIG = 0x02014b50;
  const minEocd = 22;
  if (buf.length < minEocd) return null;
  // EOCD sits at the end of the file, possibly behind a comment (≤ 64 KiB).
  const scanFrom = Math.max(0, buf.length - 65536 - minEocd);
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDIR_SIG) return null;
    const uncompressed = buf.readUInt32LE(offset + 24);
    // 0xFFFFFFFF marks ZIP64 — far beyond any legitimate Linkt export.
    if (uncompressed === 0xffffffff) return null;
    total += uncompressed;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

function toRowMatrix(input: Buffer | string): string[][] {
  // XLSX (a zip) starts with the bytes "PK". Anything else is treated as CSV.
  const isXlsx =
    Buffer.isBuffer(input) && input.length > 1 && input[0] === 0x50 && input[1] === 0x4b;
  if (isXlsx) {
    const declared = declaredZipUncompressedBytes(input);
    if (declared === null || declared > MAX_DECLARED_UNCOMPRESSED_BYTES) {
      throw new Error(
        "XLSX rejected: the archive is malformed or declares an implausibly large " +
          "uncompressed size. Export the trips as CSV and retry.",
      );
    }
    const wb = XLSX.read(input, { type: "buffer", sheetRows: MAX_SHEET_ROWS });
    const name = wb.SheetNames[0];
    const sheet = name ? wb.Sheets[name] : undefined;
    if (!sheet) return [];
    return XLSX.utils
      .sheet_to_json(sheet, { header: 1, raw: false, blankrows: false })
      .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : []));
  }
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map(splitCsvLine);
}

/**
 * Locate the header row — Linkt exports can carry a preamble (account name,
 * date range) above the real column header. We look for the first row that
 * has a date-ish column, an amount-ish column, and a plate/toll-point column.
 */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols = (rows[i] ?? []).map((c) => c.toLowerCase());
    const hasDate = cols.some((c) => /date|time/.test(c));
    const hasAmount = cols.some((c) => /amount|cost|charge|debit|price/.test(c));
    const hasPlateOrPoint = cols.some((c) =>
      /plate|lpn|licen[cs]e|rego|registration|vehicle|toll\s*point|location|gantry/.test(c),
    );
    if (hasDate && hasAmount && hasPlateOrPoint) return i;
  }
  return 0;
}

type ColumnMap = {
  plate: number;
  timestamp: number;
  amount: number;
  tollpoint: number;
  type: number;
};

function mapColumns(header: string[]): ColumnMap {
  const cols = header.map((c) => c.toLowerCase().trim());
  const find = (re: RegExp) => cols.findIndex((c) => re.test(c));
  const firstOf = (...res: RegExp[]) => {
    for (const re of res) {
      const i = find(re);
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    plate: firstOf(/plate|lpn|licen[cs]e\s*plate|registration|rego/, /vehicle/),
    timestamp: firstOf(/date.*time|date\s*&?\s*time|transaction\s*date|trip\s*date/, /date|time/),
    // "toll point" / "location" deliberately excluded from amount matching.
    amount: firstOf(/trip\s*cost|toll\s*amount/, /amount|cost|charge|debit|price/),
    tollpoint: firstOf(/toll\s*point|tollpoint|gantry/, /location|road|motorway|point|description/),
    type: firstOf(/transaction\s*type|activity\s*type|^type$/),
  };
}

function parseLinktDate(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;
  // Construct as AEST (+10). Linkt NSW/VIC observe daylight saving (+11) for
  // part of the year; the booking-window matcher tolerates the ≤1h drift.
  // Confirm the export's actual timezone against the Phase-0 sample.
  const aest = (y: number, mo: number, d: number, h: number, mi: number, sec: number) =>
    new Date(Date.UTC(y, mo - 1, d, h - 10, mi, sec));

  // ISO-ish: YYYY-MM-DD[ T]HH:MM[:SS]
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return aest(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6] : 0);

  // AU: DD/MM/YYYY [HH:MM[:SS]] [am/pm]
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (m) {
    let hh = m[4] ? +m[4] : 0;
    const ap = (m[7] ?? "").toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    return aest(+m[3]!, +m[2]!, +m[1]!, hh, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  }
  return null;
}

function parseAmountCents(s: string): number | null {
  // Keep the sign so credits/payments (negative) can be filtered out when
  // there is no explicit transaction-type column to lean on.
  const neg = /^\s*[-(]/.test(s);
  const n = Number.parseFloat(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

export function normalisePlate(s: string): string {
  return (s ?? "").toUpperCase().replace(/[\s\-]/g, "");
}

/**
 * Parse a Linkt trip-history export (CSV or XLSX buffer, or a CSV string in
 * tests) into normalised trip rows. Header names / date format / sign
 * convention are matched flexibly and MUST be reconciled with the Phase-0
 * sample export.
 */
export function parseLinktExport(input: Buffer | string, account: { id: string }): LinktTripRow[] {
  const rows = toRowMatrix(input);
  if (rows.length < 2) return [];

  const headerIdx = findHeaderRow(rows);
  const header = rows[headerIdx] ?? [];
  const idx = mapColumns(header);
  if (idx.timestamp < 0 || idx.amount < 0) return [];

  const out: LinktTripRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.length === 0) continue;

    // When a transaction-type column exists, keep only trip/toll rows (mirrors
    // the e-toll `type !== "Trip"` guard); otherwise fall back to the sign.
    const hasTypeCol = idx.type >= 0;
    if (hasTypeCol) {
      const typeVal = (cells[idx.type] ?? "").toLowerCase();
      if (typeVal && !/trip|toll/.test(typeVal)) continue;
    }

    const eventAt = parseLinktDate(cells[idx.timestamp] ?? "");
    if (!eventAt) continue;

    const signed = parseAmountCents(cells[idx.amount] ?? "");
    if (signed === null) continue;
    // With a type column we trust it and take the magnitude; without one, a
    // non-positive amount is a credit/payment and is skipped.
    const amountCents = hasTypeCol ? Math.abs(signed) : signed;
    if (amountCents <= 0) continue;

    const plate = normalisePlate(idx.plate >= 0 ? cells[idx.plate] ?? "" : "");
    const tollpoint = (idx.tollpoint >= 0 ? cells[idx.tollpoint] ?? "" : "").trim();
    const externalHash = createHash("sha256")
      .update([account.id, plate, eventAt.toISOString(), amountCents, tollpoint].join("|"))
      .digest("hex");

    out.push({
      externalHash,
      eventAt,
      plate,
      tollpoint,
      amountCents,
      rawDetails: cells.join(" | "),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export type LinktMatch = {
  vehicleId: string;
  bookingId: string | null;
  customerId: string | null;
};

export async function matchTripRow(
  prisma: PrismaClient,
  row: LinktTripRow,
): Promise<LinktMatch | null> {
  const token = normalisePlate(row.plate);
  if (!token) return null;
  // Vehicle.rego isn't stored normalised; gpsTrackerId holds the toll tag id
  // when the depot registers tags per vehicle. Try rego then tag, comparing
  // normalised in JS (mirrors etoll.matchTripRow).
  const vehicles = await prisma.vehicle.findMany({
    select: { id: true, rego: true, gpsTrackerId: true },
  });
  const vehicle =
    vehicles.find((v) => normalisePlate(v.rego) === token) ??
    vehicles.find((v) => v.gpsTrackerId && normalisePlate(v.gpsTrackerId) === token);
  if (!vehicle) return null;

  const booking = await prisma.booking.findFirst({
    where: {
      vehicleId: vehicle.id,
      pickupDateTime: { lte: row.eventAt },
      returnDateTime: { gte: row.eventAt },
    },
    select: { id: true, customerId: true },
    orderBy: { pickupDateTime: "desc" },
  });

  return {
    vehicleId: vehicle.id,
    bookingId: booking?.id ?? null,
    customerId: booking?.customerId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Classify + upsert (idempotent) — ported verbatim from etoll for independence
// ---------------------------------------------------------------------------

export type CreateResult = "created" | "duplicate" | "unmatched";

export type RowAction =
  | { type: "skip-duplicate" }
  | { type: "skip-dismissed" }
  | { type: "create-and-resolve-existing" }
  | { type: "create-new" }
  | { type: "record-unmatched" }
  | { type: "refresh-unmatched" };

/**
 * Pure decision function for what a sync should do with one Linkt row given
 * what it finds in the DB. Kept self-contained (a port of etoll's, not an
 * import) so the legacy e-toll module can be retired without breaking Linkt.
 */
export function classifyRowAction(input: {
  existingInfringement: boolean;
  existingUnmatched: { resolvedAt: Date | null; resolvedAction: string | null } | null;
  matched: boolean;
}): RowAction {
  if (input.existingInfringement) return { type: "skip-duplicate" };

  const prevDismissed =
    input.existingUnmatched?.resolvedAt != null &&
    input.existingUnmatched.resolvedAction === "DISMISSED";
  if (prevDismissed) return { type: "skip-dismissed" };

  if (input.matched) {
    const hasPendingUnmatched =
      input.existingUnmatched != null && input.existingUnmatched.resolvedAt == null;
    return hasPendingUnmatched
      ? { type: "create-and-resolve-existing" }
      : { type: "create-new" };
  }

  return input.existingUnmatched ? { type: "refresh-unmatched" } : { type: "record-unmatched" };
}

/** Per-account fee override, else the global configured toll admin fee. */
async function resolveAdminFeeAud(account: LinktAccount): Promise<number> {
  if (account.adminFeeCents > 0) return account.adminFeeCents / 100;
  const { getTollAdminFee } = await import("./toll-admin-fee");
  return getTollAdminFee();
}

export async function upsertInfringementFromRow(
  prisma: PrismaClient,
  row: LinktTripRow,
  account: LinktAccount,
): Promise<CreateResult> {
  const existing = await prisma.infringement.findUnique({
    where: { referenceNumber: row.externalHash },
    select: { id: true },
  });

  const existingUnmatched = await prisma.linktUnmatchedRow.findUnique({
    where: { externalHash: row.externalHash },
    select: { id: true, resolvedAt: true, resolvedAction: true },
  });

  const match =
    existing || existingUnmatched?.resolvedAction === "DISMISSED"
      ? null
      : await matchTripRow(prisma, row);

  const action = classifyRowAction({
    existingInfringement: !!existing,
    existingUnmatched: existingUnmatched
      ? { resolvedAt: existingUnmatched.resolvedAt, resolvedAction: existingUnmatched.resolvedAction }
      : null,
    matched: !!match,
  });

  switch (action.type) {
    case "skip-duplicate":
    case "skip-dismissed":
      return "duplicate";

    case "record-unmatched":
      await prisma.linktUnmatchedRow.create({
        data: {
          accountId: account.id,
          externalHash: row.externalHash,
          eventAt: row.eventAt,
          plate: row.plate,
          tollpoint: row.tollpoint,
          rawDetails: row.rawDetails,
          amountCents: row.amountCents,
        },
      });
      return "unmatched";

    case "refresh-unmatched":
      return "unmatched";

    case "create-new":
    case "create-and-resolve-existing": {
      if (!match) return "unmatched";
      const tollAud = row.amountCents / 100;
      const adminFeeAud = await resolveAdminFeeAud(account);
      const infringement = await prisma.infringement.create({
        data: {
          vehicleId: match.vehicleId,
          bookingId: match.bookingId,
          customerId: match.customerId,
          type: "TOLL",
          issuer: `Linkt-${account.region} (${account.name})`,
          referenceNumber: row.externalHash,
          offenceDate: row.eventAt,
          amount: new Prisma.Decimal(tollAud.toFixed(2)),
          adminFee: new Prisma.Decimal(adminFeeAud.toFixed(2)),
          status: match.bookingId ? "CUSTOMER_CHARGED" : "RECEIVED",
          notes: `Toll: ${row.tollpoint || "—"}. Source: ${row.rawDetails}`,
        },
      });

      if (action.type === "create-and-resolve-existing" && existingUnmatched) {
        await prisma.linktUnmatchedRow.update({
          where: { id: existingUnmatched.id },
          data: {
            resolvedAt: new Date(),
            resolvedAction: "AUTO_MATCHED",
            resolvedInfringementId: infringement.id,
          },
        });
      }

      if (match.bookingId && match.customerId) {
        const { applyInfringementRecoveryCharge } = await import("./infringement-charge");
        await applyInfringementRecoveryCharge({
          prisma,
          infringement: {
            id: infringement.id,
            referenceNumber: infringement.referenceNumber,
            type: infringement.type,
            issuer: infringement.issuer,
            amount: tollAud,
            adminFee: adminFeeAud,
            bookingId: match.bookingId,
            customerId: match.customerId,
          },
        });
      }
      return "created";
    }
  }
}

// ---------------------------------------------------------------------------
// Run a sync (called by tRPC and by the BullMQ worker)
// ---------------------------------------------------------------------------

async function rebuildPendingRowsForRematch(
  prisma: PrismaClient,
  accountId: string,
): Promise<LinktTripRow[]> {
  const pending = await prisma.linktUnmatchedRow.findMany({
    where: { accountId, resolvedAt: null },
    orderBy: { eventAt: "asc" },
  });
  return pending.map((p) => ({
    externalHash: p.externalHash,
    eventAt: p.eventAt,
    plate: p.plate,
    tollpoint: p.tollpoint,
    amountCents: p.amountCents,
    rawDetails: p.rawDetails ?? "",
  }));
}

export async function runLinktSync(
  prisma: PrismaClient,
  accountId: string,
  opts?: { buffer?: Buffer },
): Promise<{ syncId: string; status: string }> {
  const account = await prisma.linktAccount.findUniqueOrThrow({ where: { id: accountId } });

  const lastSuccess = await prisma.linktSync.findFirst({
    where: { accountId, status: "SUCCESS" },
    orderBy: { finishedAt: "desc" },
  });
  const periodFrom = lastSuccess?.periodTo ?? new Date("2000-01-01");
  const periodTo = new Date();

  const sync = await prisma.linktSync.create({
    data: { accountId, status: "RUNNING", periodFrom, periodTo },
  });

  let rows: LinktTripRow[];
  if (opts?.buffer) {
    // A staff member uploaded Linkt's official CSV/Excel trip export. Parsing
    // is the only source-specific step; everything downstream is unchanged.
    try {
      rows = parseLinktExport(opts.buffer, account);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.linktSync.update({
        where: { id: sync.id },
        data: { status: "FAILED", finishedAt: new Date(), error: `parse: ${msg}` },
      });
      await prisma.linktAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date(), lastSyncStatus: "FAILED", lastSyncError: `parse: ${msg}` },
      });
      return { syncId: sync.id, status: "FAILED" };
    }
  } else {
    // No upload — re-feed still-pending unmatched rows through the matcher so
    // fleet/booking changes since they were captured can resolve them
    // automatically. (Linkt has no pollable feed; new trips arrive via upload.)
    rows = await rebuildPendingRowsForRematch(prisma, accountId);
  }

  let created = 0;
  let duplicate = 0;
  let unmatched = 0;
  const unmatchedRows: Array<Pick<LinktTripRow, "eventAt" | "plate" | "tollpoint" | "amountCents" | "externalHash">> = [];

  for (const row of rows) {
    const result = await upsertInfringementFromRow(prisma, row, account);
    if (result === "created") created++;
    else if (result === "duplicate") duplicate++;
    else {
      unmatched++;
      unmatchedRows.push({
        eventAt: row.eventAt,
        plate: row.plate,
        tollpoint: row.tollpoint,
        amountCents: row.amountCents,
        externalHash: row.externalHash,
      });
    }
  }

  const finalStatus = unmatched > 0 ? "PARTIAL" : "SUCCESS";
  await prisma.linktSync.update({
    where: { id: sync.id },
    data: {
      status: finalStatus,
      finishedAt: new Date(),
      rowsFetched: rows.length,
      rowsCreated: created,
      rowsDuplicate: duplicate,
      rowsUnmatched: unmatched,
      rowsSkipped: 0,
      unmatched:
        unmatchedRows.length > 0
          ? (unmatchedRows as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });

  await prisma.linktAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: new Date(), lastSyncStatus: finalStatus, lastSyncError: null },
  });

  return { syncId: sync.id, status: finalStatus };
}
