/**
 * Linkt (Transurban) toll integration service.
 *
 * Linkt is a single Transurban account spanning NSW/VIC/QLD toll roads.
 * XPERT Moto's fleet tolls run through this provider (it superseded the
 * former NSW E-Toll integration, now removed). This module:
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
 * `parseLinktExport` is reconciled against a real Linkt CSV export (2026-06-15)
 * — see its doc comment for the exact column/sign/identity handling.
 */
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { Prisma, type LinktAccount, type PrismaClient } from "@prisma/client";

import {
  findBookingForVehicleAt,
  normalisePlate,
  resolveVehicleByPlate,
} from "./booking-matcher";

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
  tag: number;
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
    // E-tag column — the real Linkt export identifies the vehicle by tag when
    // the LPN/plate column is blank.
    tag: firstOf(/tag\s*number|tag\s*no\.?|^tag$|e-?tag/),
    timestamp: firstOf(/date.*time|date\s*&?\s*time|transaction\s*date|trip\s*date|start\s*date/, /date|time/),
    // "toll point" / "location" deliberately excluded from amount matching.
    amount: firstOf(/trip\s*cost|toll\s*amount/, /amount|cost|charge|debit|price/),
    tollpoint: firstOf(/toll\s*point|tollpoint|gantry/, /location|road|motorway|point|description|details/),
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

// Re-exported from the shared booking matcher so the historical import site
// (`@/server/services/linkt`) keeps working.
export { normalisePlate };

/**
 * Parse a Linkt trip-history export (CSV or XLSX buffer, or a CSV string in
 * tests) into normalised trip rows. Reconciled against a real export
 * (2026-06-15): columns `Start Date, End Date, Type, Details, LPN, Tag number,
 * Fleet ID, Vehicle class, Amount`; trip `Amount` is NEGATIVE (a debit) and the
 * `Type` column ("Trips") gates real tolls, so we trust the type and take the
 * magnitude; the vehicle is identified by `Tag number` when `LPN` is blank.
 * Header matching stays flexible to tolerate minor column-name drift.
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

    // Identify the vehicle by LPN/plate, falling back to the e-tag number when
    // the plate column is blank (the real Linkt export populates one or the
    // other). resolveVehicleByPlate matches either against Vehicle.rego or
    // Vehicle.gpsTrackerId.
    const lpn = (idx.plate >= 0 ? cells[idx.plate] ?? "" : "").trim();
    const tag = (idx.tag >= 0 ? cells[idx.tag] ?? "" : "").trim();
    const plate = normalisePlate(lpn || tag);
    const tollpoint = (idx.tollpoint >= 0 ? cells[idx.tollpoint] ?? "" : "").trim().replace(/\s+/g, " ");
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
  // Shared with the NSW infringement-nomination flow — see booking-matcher.ts.
  // (The matcher prefers actual check-out/return times and restricts to
  // statuses where the vehicle was genuinely out with a renter.)
  const vehicle = await resolveVehicleByPlate(prisma, row.plate);
  if (!vehicle) return null;

  const booking = await findBookingForVehicleAt(prisma, vehicle.id, row.eventAt);

  return {
    vehicleId: vehicle.id,
    bookingId: booking?.id ?? null,
    customerId: booking?.customerId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Classify + upsert (idempotent)
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
 * what it finds in the DB. Kept self-contained so the matching pipeline has
 * no external coupling.
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

/**
 * Re-attribute previously unattributable tolls. A trip that resolved to a
 * vehicle but had no booking spanning it at sync time is recorded as a
 * `RECEIVED` TOLL `Infringement` with no charge (there was no renter to bill).
 * If a booking for that vehicle+time later exists — a backdated check-out, a
 * corrected booking, or a late-entered walk-in — this pass links the
 * infringement to it and raises the recovery charge, so the renter is billed
 * once an account becomes available.
 *
 * Idempotent: `applyInfringementRecoveryCharge` keys on
 * `INFR-${referenceNumber}`, so re-running never double-charges. Scoped to a
 * single account by exact issuer match. Returns the number of tolls newly
 * charged.
 */
export async function reconcileReceivedTolls(
  prisma: PrismaClient,
  account: LinktAccount,
): Promise<number> {
  const received = await prisma.infringement.findMany({
    where: {
      type: "TOLL",
      bookingId: null,
      status: "RECEIVED",
      issuer: `Linkt-${account.region} (${account.name})`,
    },
    select: {
      id: true,
      referenceNumber: true,
      type: true,
      issuer: true,
      amount: true,
      adminFee: true,
      vehicleId: true,
      offenceDate: true,
    },
  });

  let charged = 0;
  for (const inf of received) {
    const booking = await findBookingForVehicleAt(prisma, inf.vehicleId, inf.offenceDate);
    if (!booking) continue;

    await prisma.infringement.update({
      where: { id: inf.id },
      data: {
        bookingId: booking.id,
        customerId: booking.customerId,
        status: "CUSTOMER_CHARGED",
      },
    });

    const { applyInfringementRecoveryCharge } = await import("./infringement-charge");
    await applyInfringementRecoveryCharge({
      prisma,
      infringement: {
        id: inf.id,
        referenceNumber: inf.referenceNumber,
        type: inf.type,
        issuer: inf.issuer,
        amount: inf.amount,
        adminFee: inf.adminFee,
        bookingId: booking.id,
        customerId: booking.customerId,
      },
    });
    charged += 1;
  }
  return charged;
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

  // Rematch pass only: re-attribute vehicle-only tolls from earlier syncs whose
  // booking now exists, charging the renter once an account becomes available.
  // (Scoped to the automatic no-upload cadence, same as the unmatched rematch.)
  if (!opts?.buffer) {
    await reconcileReceivedTolls(prisma, account);
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

// ---------------------------------------------------------------------------
// Summary stats (for the weekly toll-sync digest email)
// ---------------------------------------------------------------------------

/**
 * Tolls land in one of three buckets (see `upsertInfringementFromRow` above):
 *   - matched to a booking — TOLL `Infringement` with `bookingId != null`
 *     (charged to the hire; the vehicle always carries a rego, i.e. a plate).
 *   - vehicle known, no booking — TOLL `Infringement` with `bookingId == null`
 *     (vehicle resolved by plate/tag but no active hire spanned the trip).
 *   - unmatched — pending `LinktUnmatchedRow` (no vehicle could be resolved).
 * Resolved unmatched rows are excluded from the total: an AUTO_MATCHED row
 * also has an `Infringement`, so counting both would double-count.
 */
export type TollSummaryRow = {
  eventAt: Date;
  plate: string; // "" when no plate/tag was on the trip
  tollpoint: string;
  amountCents: number;
  matchedBooking: string | null; // booking reference when matched, else null
  status: "MATCHED" | "NO_BOOKING" | "UNMATCHED";
};

export type TollSummaryStats = {
  totalTolls: number;
  matchedToBooking: number;
  unmatchedToBooking: number; // vehicle-no-booking + pending-unmatched
  withPlate: number;
  withoutPlate: number;
  lastSync: { status: string; finishedAt: Date | null } | null;
  recent: TollSummaryRow[]; // last 7 days, newest first
  recentTruncated: boolean;
};

const RECENT_ROW_CAP = 100;

/** Pull "Toll: <tollpoint>." back out of the Infringement notes blob. */
function tollpointFromNotes(notes: string | null): string {
  if (!notes) return "";
  const m = notes.match(/^Toll:\s*(.*?)\.\s*Source:/);
  const t = (m?.[1] ?? "").trim();
  return t === "—" ? "" : t;
}

export async function getTollSummaryStats(
  prisma: PrismaClient,
  opts?: { now?: Date; sevenDaysMs?: number },
): Promise<TollSummaryStats> {
  const now = opts?.now ?? new Date();
  const since = new Date(now.getTime() - (opts?.sevenDaysMs ?? 7 * 24 * 60 * 60 * 1000));

  const [matchedToBooking, vehicleNoBooking, pendingUnmatched, withoutPlate, lastSync] =
    await Promise.all([
      prisma.infringement.count({
        where: { type: "TOLL", deletedAt: null, bookingId: { not: null } },
      }),
      prisma.infringement.count({
        where: { type: "TOLL", deletedAt: null, bookingId: null },
      }),
      prisma.linktUnmatchedRow.count({ where: { resolvedAt: null } }),
      prisma.linktUnmatchedRow.count({ where: { resolvedAt: null, plate: "" } }),
      prisma.linktSync.findFirst({
        where: { finishedAt: { not: null } },
        orderBy: { finishedAt: "desc" },
        select: { status: true, finishedAt: true },
      }),
    ]);

  const totalTolls = matchedToBooking + vehicleNoBooking + pendingUnmatched;
  const unmatchedToBooking = vehicleNoBooking + pendingUnmatched;
  const withPlate = totalTolls - withoutPlate;

  // Last-7-days rows: matched/vehicle-known tolls (Infringement) unioned with
  // still-pending unmatched rows, newest first, capped.
  const [recentInfringements, recentUnmatched] = await Promise.all([
    prisma.infringement.findMany({
      where: { type: "TOLL", deletedAt: null, offenceDate: { gte: since } },
      orderBy: { offenceDate: "desc" },
      take: RECENT_ROW_CAP + 1,
      select: {
        offenceDate: true,
        amount: true,
        bookingId: true,
        notes: true,
        vehicle: { select: { rego: true } },
        booking: { select: { bookingReference: true } },
      },
    }),
    prisma.linktUnmatchedRow.findMany({
      where: { resolvedAt: null, eventAt: { gte: since } },
      orderBy: { eventAt: "desc" },
      take: RECENT_ROW_CAP + 1,
      select: { eventAt: true, plate: true, tollpoint: true, amountCents: true },
    }),
  ]);

  const rows: TollSummaryRow[] = [
    ...recentInfringements.map((i): TollSummaryRow => ({
      eventAt: i.offenceDate,
      plate: i.vehicle?.rego ?? "",
      tollpoint: tollpointFromNotes(i.notes),
      amountCents: Math.round(Number(i.amount) * 100),
      matchedBooking: i.booking?.bookingReference ?? null,
      status: i.bookingId ? "MATCHED" : "NO_BOOKING",
    })),
    ...recentUnmatched.map((u): TollSummaryRow => ({
      eventAt: u.eventAt,
      plate: u.plate,
      tollpoint: u.tollpoint,
      amountCents: u.amountCents,
      matchedBooking: null,
      status: "UNMATCHED",
    })),
  ].sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());

  const recentTruncated = rows.length > RECENT_ROW_CAP;
  const recent = rows.slice(0, RECENT_ROW_CAP);

  return {
    totalTolls,
    matchedToBooking,
    unmatchedToBooking,
    withPlate,
    withoutPlate,
    lastSync: lastSync ? { status: lastSync.status, finishedAt: lastSync.finishedAt } : null,
    recent,
    recentTruncated,
  };
}
