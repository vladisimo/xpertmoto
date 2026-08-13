/**
 * Bulk ingestion of NSW penalty notices from the Service NSW / eNominations
 * operator portal export.
 *
 * Revenue NSW has no API. A staff member downloads the "outstanding fines"
 * CSV/Excel from the operator portal and uploads it here. We parse it, match
 * each notice to the renter who held the vehicle at the offence time, and
 * create an Infringement in PENDING_REVIEW — never auto-nominated, because a
 * false nomination to Revenue NSW is a criminal offence. Staff confirm the
 * renter + handling in the nomination workspace (nomination.allocate).
 *
 * This is the inverse of the Linkt toll flow (which charges immediately): here
 * we only stage the infringement for review.
 *
 * PROVISIONAL: the eNominations column layout is best-effort and must be
 * reconciled against a real portal export — the same file shape is re-emitted
 * by `buildENominationsCsv` for the upload-back step.
 */
import * as XLSX from "xlsx";
import { Prisma, type PrismaClient } from "@prisma/client";

import { computeNominationDeadline, defaultHandlingForType } from "@/lib/nsw-nomination";
import {
  resolveBookingForVehicleAt,
  resolveVehicleByPlate,
} from "./booking-matcher";

export type RevenueNswRow = {
  penaltyNoticeNumber: string;
  rego: string;
  offenceDate: Date;
  issueDate: Date | null;
  amountAud: number;
  offenceCode: string | null;
  offenceDescription: string | null;
  offenceLocation: string | null;
  demeritPoints: number;
  type: RevenueNswType;
  issuer: string;
};

type RevenueNswType =
  | "SPEEDING"
  | "PARKING"
  | "TOLL"
  | "RED_LIGHT"
  | "MOBILE_PHONE"
  | "SEATBELT"
  | "UNREGISTERED"
  | "OTHER";

const MAX_SHEET_ROWS = 100_000;

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

function toRowMatrix(input: Buffer | string): string[][] {
  const isXlsx =
    Buffer.isBuffer(input) && input.length > 1 && input[0] === 0x50 && input[1] === 0x4b;
  if (isXlsx) {
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

function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols = (rows[i] ?? []).map((c) => c.toLowerCase());
    const hasNotice = cols.some((c) => /penalty|notice|infringement|reference/.test(c));
    const hasRego = cols.some((c) => /rego|registration|plate|vehicle/.test(c));
    const hasDate = cols.some((c) => /date/.test(c));
    if (hasNotice && hasRego && hasDate) return i;
  }
  return 0;
}

type ColumnMap = {
  noticeNumber: number;
  rego: number;
  offenceDate: number;
  issueDate: number;
  amount: number;
  offenceCode: number;
  offenceDescription: number;
  offenceLocation: number;
  demeritPoints: number;
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
    noticeNumber: firstOf(/penalty\s*notice|notice\s*number|infringement\s*number|reference/),
    rego: firstOf(/registration|rego|plate/, /vehicle/),
    offenceDate: firstOf(/offence\s*date|date\s*of\s*offence/, /^date$|date.*time/),
    issueDate: firstOf(/issue\s*date|date\s*issued|served/),
    amount: firstOf(/amount|penalty\s*amount|fine|cost/),
    offenceCode: firstOf(/offence\s*code|code/),
    offenceDescription: firstOf(/offence\s*desc|description|offence$/),
    offenceLocation: firstOf(/location|place|where/),
    demeritPoints: firstOf(/demerit/),
  };
}

/** Parse a date in ISO (YYYY-MM-DD) or AU (DD/MM/YYYY) form to UTC midnight. */
function parseDate(s: string): Date | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!));
  return null;
}

function parseAmountAud(s: string): number | null {
  const n = Number.parseFloat((s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Heuristic offence classification from the printed description/code. */
export function classifyOffence(text: string): RevenueNswType {
  const t = (text ?? "").toLowerCase();
  if (/red\s*light|traffic\s*light/.test(t)) return "RED_LIGHT";
  if (/speed|exceed.*limit|km\/?h/.test(t)) return "SPEEDING";
  if (/mobile|phone|device/.test(t)) return "MOBILE_PHONE";
  if (/seat\s*belt|seatbelt|restraint/.test(t)) return "SEATBELT";
  if (/unregistered|registration.*expired|no.*registration/.test(t)) return "UNREGISTERED";
  if (/park|no\s*stopping|clearway|bus\s*lane/.test(t)) return "PARKING";
  if (/toll/.test(t)) return "TOLL";
  return "OTHER";
}

function cell(cells: string[], idx: number): string {
  return idx >= 0 ? cells[idx] ?? "" : "";
}

export function parseRevenueNswExport(input: Buffer | string): RevenueNswRow[] {
  const rows = toRowMatrix(input);
  if (rows.length < 2) return [];
  const headerIdx = findHeaderRow(rows);
  const idx = mapColumns(rows[headerIdx] ?? []);
  if (idx.noticeNumber < 0 || idx.offenceDate < 0) return [];

  const out: RevenueNswRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.length === 0) continue;

    const noticeNumber = cell(cells, idx.noticeNumber).trim();
    const offenceDate = parseDate(cell(cells, idx.offenceDate));
    if (!noticeNumber || !offenceDate) continue;

    const description = cell(cells, idx.offenceDescription).trim() || null;
    const code = cell(cells, idx.offenceCode).trim() || null;
    const demeritRaw = Number.parseInt(cell(cells, idx.demeritPoints), 10);
    out.push({
      penaltyNoticeNumber: noticeNumber,
      rego: cell(cells, idx.rego).trim(),
      offenceDate,
      issueDate: parseDate(cell(cells, idx.issueDate)),
      amountAud: parseAmountAud(cell(cells, idx.amount)) ?? 0,
      offenceCode: code,
      offenceDescription: description,
      offenceLocation: cell(cells, idx.offenceLocation).trim() || null,
      demeritPoints: Number.isFinite(demeritRaw) ? Math.max(0, demeritRaw) : 0,
      type: classifyOffence(`${description ?? ""} ${code ?? ""}`),
      issuer: "Revenue NSW",
    });
  }
  return out;
}

export type ImportSummary = {
  rowsParsed: number;
  created: number;
  duplicate: number;
  matched: number;
  unmatched: number;
};

/**
 * Create staged Infringement rows from parsed Revenue NSW notices. Idempotent
 * on `referenceNumber` (the penalty notice number). Matched notices land in
 * PENDING_REVIEW; unmatched ones (no vehicle / no active booking) in RECEIVED
 * for manual linking. Never charges or nominates automatically.
 */
export async function importRevenueNswRows(
  prisma: PrismaClient,
  rows: RevenueNswRow[],
): Promise<ImportSummary> {
  let created = 0;
  let duplicate = 0;
  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    const existing = await prisma.infringement.findUnique({
      where: { referenceNumber: row.penaltyNoticeNumber },
      select: { id: true },
    });
    if (existing) {
      duplicate++;
      continue;
    }

    const vehicle = await resolveVehicleByPlate(prisma, row.rego);
    const resolution = vehicle
      ? await resolveBookingForVehicleAt(prisma, vehicle.id, row.offenceDate)
      : null;
    const booking = resolution?.kind === "match" ? resolution.booking : null;
    if (booking) matched++;
    else unmatched++;

    // Unmatched notices have no vehicle to attach to; the Infringement model
    // requires a vehicleId, so skip rows whose rego we can't resolve and leave
    // them for manual entry (surfaced via the import summary count).
    if (!vehicle) continue;

    // Overlapping candidate bookings at the offence time → stay RECEIVED with
    // the candidates listed for staff, never a guessed link (false nomination
    // to Revenue NSW is a criminal offence).
    const ambiguityNote =
      resolution?.kind === "ambiguous"
        ? ` Attribution ambiguous — overlapping bookings held this vehicle at the offence time: ${resolution.candidates.map((c) => c.bookingReference).join(", ")}. Staff must confirm the renter before nomination.`
        : "";

    await prisma.infringement.create({
      data: {
        vehicleId: vehicle.id,
        bookingId: booking?.id ?? null,
        customerId: booking?.customerId ?? null,
        type: row.type,
        issuer: row.issuer,
        referenceNumber: row.penaltyNoticeNumber,
        offenceDate: row.offenceDate,
        amount: new Prisma.Decimal(row.amountAud.toFixed(2)),
        issueDate: row.issueDate,
        offenceCode: row.offenceCode,
        offenceDescription: row.offenceDescription,
        offenceLocation: row.offenceLocation,
        demeritPoints: row.demeritPoints,
        handling: defaultHandlingForType(row.type),
        nominationDeadline: row.issueDate ? computeNominationDeadline(row.issueDate) : null,
        status: booking ? "PENDING_REVIEW" : "RECEIVED",
        notes: `Imported from Revenue NSW portal export.${ambiguityNote}`,
      },
    });
    created++;
  }

  return { rowsParsed: rows.length, created, duplicate, matched, unmatched };
}

/** Parse + import in one call. */
export async function runRevenueNswImport(
  prisma: PrismaClient,
  buffer: Buffer,
): Promise<ImportSummary> {
  const rows = parseRevenueNswExport(buffer);
  return importRevenueNswRows(prisma, rows);
}
