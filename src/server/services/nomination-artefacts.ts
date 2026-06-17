/**
 * Generators for the official Revenue NSW nomination artefacts.
 *
 * There is no Revenue NSW API. The corporate channel is "eNominations":
 * download an outstanding-fines CSV from the portal, fill in the nominated
 * driver's details, and re-upload the CSV. The paper fallback is a witnessed
 * statutory declaration that is mailed in. This module produces both:
 *
 *   - `buildENominationsCsv` → the CSV a staff member uploads to eNominations.
 *   - `renderStatutoryDeclarationPdf` (in src/lib/pdf/statutory-declaration.tsx)
 *     → a pre-filled stat dec PDF for the witness-and-mail path.
 *
 * PROVISIONAL: the eNominations column layout is best-effort. Revenue NSW
 * publishes no machine-readable schema; the real header row must be reconciled
 * against an actual downloaded eNominations export (the same file the bulk
 * importer parses) before this is used in anger. The header is therefore
 * configurable via the `nomination.enominationsColumns` SystemSetting and the
 * `columns` argument, so it can be corrected without a code change.
 */

import type { PrismaClient } from "@prisma/client";

import { readPiiField } from "@/lib/customer-pii";

/** Immutable nominee snapshot, frozen at draft time. Licence number is the
 * already-decrypted value (the caller decrypts via readPiiField). */
export type NomineeSnapshot = {
  givenNames: string;
  familyName: string;
  dob: Date | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  licenceNumber: string | null;
  licenceState: string | null;
  licenceCountry: string | null;
};

export type NominationArtefactInput = {
  penaltyNoticeNumber: string;
  offenceDate: Date;
  offenceCode: string | null;
  offenceDescription: string | null;
  offenceLocation: string | null;
  issuer: string;
  vehicleRego: string;
  nominee: NomineeSnapshot;
};

/** The nominee fields Revenue NSW requires to accept a nomination. */
export const REQUIRED_NOMINEE_FIELDS = [
  "givenNames",
  "familyName",
  "dob",
  "address",
  "licenceNumber",
  "licenceState",
] as const;
export type RequiredNomineeField = (typeof REQUIRED_NOMINEE_FIELDS)[number];

/**
 * Build the nominee snapshot for a customer (the renter) from their User +
 * CustomerProfile, decrypting the licence number. Returns null if the user
 * doesn't exist. Used by the nomination router at draft time; the result is
 * frozen onto the NominationSubmission as an immutable legal record.
 */
export async function buildNomineeSnapshot(
  prisma: PrismaClient,
  customerId: string,
): Promise<NomineeSnapshot | null> {
  const user = await prisma.user.findUnique({
    where: { id: customerId },
    select: {
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      customerProfile: {
        select: {
          licenceNumber: true,
          licenceNumberEnc: true,
          licenceState: true,
          licenceCountry: true,
          addressLine1: true,
          addressLine2: true,
          suburb: true,
          state: true,
          postcode: true,
        },
      },
    },
  });
  if (!user) return null;
  const p = user.customerProfile;
  return {
    givenNames: user.firstName ?? "",
    familyName: user.lastName ?? "",
    dob: user.dateOfBirth ?? null,
    addressLine1: p?.addressLine1 ?? null,
    addressLine2: p?.addressLine2 ?? null,
    suburb: p?.suburb ?? null,
    state: p?.state ?? null,
    postcode: p?.postcode ?? null,
    licenceNumber: p ? readPiiField(p.licenceNumber, p.licenceNumberEnc) : null,
    licenceState: p?.licenceState ?? null,
    licenceCountry: p?.licenceCountry ?? null,
  };
}

/** Mask a licence number for customer-facing display, e.g. "NSW ••••1234". */
export function maskLicence(n: Pick<NomineeSnapshot, "licenceNumber" | "licenceState" | "licenceCountry">): string | null {
  if (!n.licenceNumber) return null;
  const tail = n.licenceNumber.slice(-4);
  const region = n.licenceState ?? n.licenceCountry ?? "";
  return `${region ? region + " " : ""}••••${tail}`.trim();
}

export function nomineeFullName(n: NomineeSnapshot): string {
  return [n.givenNames, n.familyName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
}

export function nomineeAddressLine(n: NomineeSnapshot): string {
  return [n.addressLine1, n.addressLine2, n.suburb, n.state, n.postcode]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Which mandatory nominee fields are still missing. The nomination flow
 * blocks artefact generation when this is non-empty — an incomplete
 * nomination is rejected by Revenue NSW and a blank stat dec is useless.
 */
export function missingNomineeFields(n: NomineeSnapshot): RequiredNomineeField[] {
  const missing: RequiredNomineeField[] = [];
  if (!n.givenNames?.trim()) missing.push("givenNames");
  if (!n.familyName?.trim()) missing.push("familyName");
  if (!n.dob) missing.push("dob");
  if (!nomineeAddressLine(n)) missing.push("address");
  if (!n.licenceNumber?.trim()) missing.push("licenceNumber");
  if (!n.licenceState?.trim() && !n.licenceCountry?.trim()) missing.push("licenceState");
  return missing;
}

function fmtDateAU(d: Date | null): string {
  if (!d) return "";
  // en-AU DD/MM/YYYY in the Sydney calendar (offence/identity dates are dates,
  // not instants, but normalise the timezone to avoid an off-by-one).
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}

/** A logical column in the eNominations CSV → how to fill it from a row. */
export type ENominationsColumn = {
  header: string;
  value: (input: NominationArtefactInput) => string;
};

/** PROVISIONAL default columns — reconcile against a real eNominations export. */
export const DEFAULT_ENOMINATIONS_COLUMNS: ENominationsColumn[] = [
  { header: "Penalty Notice Number", value: (i) => i.penaltyNoticeNumber },
  { header: "Offence Date", value: (i) => fmtDateAU(i.offenceDate) },
  { header: "Registration", value: (i) => i.vehicleRego },
  { header: "Nominated Family Name", value: (i) => i.nominee.familyName ?? "" },
  { header: "Nominated Given Names", value: (i) => i.nominee.givenNames ?? "" },
  { header: "Date of Birth", value: (i) => fmtDateAU(i.nominee.dob) },
  { header: "Residential Address", value: (i) => nomineeAddressLine(i.nominee) },
  { header: "Licence Number", value: (i) => i.nominee.licenceNumber ?? "" },
  {
    header: "Licence State/Country",
    value: (i) => i.nominee.licenceState ?? i.nominee.licenceCountry ?? "",
  },
];

/** RFC-4180-ish CSV cell escaping. */
function csvCell(value: string): string {
  const v = value ?? "";
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Build the eNominations CSV a staff member uploads to Revenue NSW. One
 * header row (which must NOT be edited in the real portal flow) followed by
 * one data row per nomination.
 */
export function buildENominationsCsv(
  rows: NominationArtefactInput[],
  columns: ENominationsColumn[] = DEFAULT_ENOMINATIONS_COLUMNS,
): string {
  const header = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

/**
 * Resolve the configured eNominations column layout. Falls back to the
 * PROVISIONAL default when the SystemSetting is absent or malformed. The
 * setting stores only header strings keyed to known value-extractors, so a
 * misconfigured row can never inject arbitrary nominee data.
 */
export function resolveENominationsColumns(
  setting: unknown,
): ENominationsColumn[] {
  if (!Array.isArray(setting) || setting.length === 0) {
    return DEFAULT_ENOMINATIONS_COLUMNS;
  }
  const byHeader = new Map(DEFAULT_ENOMINATIONS_COLUMNS.map((c) => [c.header, c]));
  const resolved: ENominationsColumn[] = [];
  for (const entry of setting) {
    // Accept either a bare header string or { header, mapsTo }.
    const header = typeof entry === "string" ? entry : (entry as { header?: string })?.header;
    const mapsTo =
      typeof entry === "object" && entry
        ? (entry as { mapsTo?: string }).mapsTo ?? header
        : header;
    if (!header || !mapsTo) continue;
    const known = byHeader.get(mapsTo);
    if (!known) continue;
    resolved.push({ header, value: known.value });
  }
  return resolved.length > 0 ? resolved : DEFAULT_ENOMINATIONS_COLUMNS;
}
