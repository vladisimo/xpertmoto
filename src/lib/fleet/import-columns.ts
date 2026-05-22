/**
 * Single source of truth for the Fleet import/export XLSX schema.
 *
 * Column order here determines header order in the template, the export,
 * and the header-sanity check in the parser. Changing this file changes
 * all three.
 */

export type ImportColumnKind =
  | "text"
  | "integer"
  | "number"
  | "date"
  | "enum";

export interface ImportColumn {
  /** Key used on the parsed row object and on `vehicleCreate` input. */
  key: string;
  /** Visible header text in the XLSX. */
  header: string;
  kind: ImportColumnKind;
  required: boolean;
  /** Allowed values when `kind === "enum"`. */
  enumValues?: readonly string[];
  /** Short help text surfaced under the header in the template's helper row. */
  hint: string;
  /** Example value written into the sample row of the template. */
  example: string;
  /** Preferred column width in the XLSX (in characters). */
  width?: number;
}

export const AU_STATES = ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"] as const;
export const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
export const DEPRECIATION_METHODS = ["STRAIGHT_LINE", "DIMINISHING_VALUE"] as const;
export const FUEL_TYPES = ["Petrol", "Electric", "Diesel"] as const;

/** Statuses a spreadsheet can assign to a vehicle.
 *
 *  RENTED / RESERVED / IN_TRANSIT are intentionally excluded — those
 *  are driven by the booking and transfer flows. Attempting to import a
 *  row with one of those statuses is rejected by the validator so nobody
 *  accidentally pretends a vehicle is mid-rental via bulk upload. */
export const IMPORTABLE_STATUSES = [
  "AVAILABLE",
  "PENDING",
  "IN_MAINTENANCE",
  "ACCIDENT_REPAIRS",
  "SOLD",
  "END_OF_LIFE",
  "STOLEN",
  "WRITTEN_OFF",
] as const;
export type ImportableStatus = (typeof IMPORTABLE_STATUSES)[number];

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: "internalCode",          header: "internalCode",          kind: "text",    required: true,  hint: "Unique code — e.g. SCT-001",          example: "SCT-IMP-001",        width: 14 },
  { key: "rego",                  header: "rego",                  kind: "text",    required: true,  hint: "Registration plate",                   example: "123-AB4",            width: 10 },
  { key: "regoState",             header: "regoState",             kind: "enum",    required: true,  enumValues: AU_STATES, hint: "QLD | NSW | VIC | TAS | SA | WA | NT | ACT", example: "QLD", width: 10 },
  { key: "make",                  header: "make",                  kind: "text",    required: true,  hint: "Manufacturer",                         example: "Honda",              width: 12 },
  { key: "model",                 header: "model",                 kind: "text",    required: true,  hint: "Model name",                           example: "PCX 150",            width: 12 },
  { key: "year",                  header: "year",                  kind: "integer", required: true,  hint: "4-digit year, 1980 – current + 1",     example: "2024",               width: 7 },
  { key: "colour",                header: "colour",                kind: "text",    required: true,  hint: "Primary colour",                       example: "White",              width: 10 },
  { key: "categoryName",          header: "categoryName",          kind: "text",    required: true,  hint: "Must match an active category on the Lookups sheet", example: "150cc Scooter", width: 18 },
  { key: "depotName",             header: "depotName",             kind: "text",    required: true,  hint: "Must match an active depot on the Lookups sheet",    example: "XPERT Moto Gold Coast", width: 22 },
  { key: "vin",                   header: "vin",                   kind: "text",    required: false, hint: "Chassis number (unique)",              example: "JHMFK1F5XXK000123",  width: 20 },
  { key: "engineNumber",          header: "engineNumber",          kind: "text",    required: false, hint: "",                                     example: "ENG-X-8812",         width: 16 },
  { key: "regoExpiry",            header: "regoExpiry",            kind: "date",    required: false, hint: "YYYY-MM-DD",                           example: "2026-12-01",         width: 12 },
  { key: "currentOdometerKm",     header: "currentOdometerKm",     kind: "integer", required: false, hint: "Integer, ≥ 0",                         example: "120",                width: 10 },
  { key: "fuelType",              header: "fuelType",              kind: "text",    required: false, hint: "Petrol | Electric | Diesel",           example: "Petrol",             width: 10 },
  { key: "status",                header: "status",                kind: "enum",    required: false, enumValues: IMPORTABLE_STATUSES, hint: "AVAILABLE | PENDING | IN_MAINTENANCE | ACCIDENT_REPAIRS | SOLD | END_OF_LIFE | STOLEN | WRITTEN_OFF — defaults to AVAILABLE", example: "AVAILABLE", width: 18 },
  { key: "condition",             header: "condition",             kind: "enum",    required: false, enumValues: CONDITIONS, hint: "EXCELLENT | GOOD | FAIR | POOR", example: "EXCELLENT", width: 12 },
  { key: "notes",                 header: "notes",                 kind: "text",    required: false, hint: "",                                     example: "New unit, dealer delivery", width: 30 },
  { key: "purchaseDate",          header: "purchaseDate",          kind: "date",    required: false, hint: "YYYY-MM-DD",                           example: "2026-02-14",         width: 12 },
  { key: "purchasePrice",         header: "purchasePrice",         kind: "number",  required: false, hint: "AUD, GST-inclusive",                   example: "5990.00",            width: 12 },
  { key: "depreciationMethod",    header: "depreciationMethod",    kind: "enum",    required: false, enumValues: DEPRECIATION_METHODS, hint: "STRAIGHT_LINE | DIMINISHING_VALUE", example: "STRAIGHT_LINE", width: 18 },
  { key: "depreciationRate",      header: "depreciationRate",      kind: "number",  required: false, hint: "Percent per year (e.g. 20 for 20%)",  example: "20",                 width: 10 },
  { key: "insurancePolicyNumber", header: "insurancePolicyNumber", kind: "text",    required: false, hint: "",                                     example: "POL-991234",         width: 16 },
  { key: "insuranceExpiry",       header: "insuranceExpiry",       kind: "date",    required: false, hint: "YYYY-MM-DD",                           example: "2027-02-14",         width: 12 },
  { key: "ctpExpiry",             header: "ctpExpiry",             kind: "date",    required: false, hint: "YYYY-MM-DD",                           example: "2027-02-14",         width: 12 },
  { key: "warrantyExpiry",        header: "warrantyExpiry",        kind: "date",    required: false, hint: "YYYY-MM-DD",                           example: "2028-02-14",         width: 12 },
  { key: "supplierName",          header: "supplierName",          kind: "text",    required: false, hint: "",                                     example: "Gold Coast Motorcycles", width: 22 },
  { key: "supplierContact",       header: "supplierContact",       kind: "text",    required: false, hint: "Phone or email",                       example: "sales@gcm.com.au",   width: 22 },
  { key: "financeType",           header: "financeType",           kind: "text",    required: false, hint: "CASH | LOAN | LEASE | CHATTEL_MORTGAGE", example: "CASH",             width: 12 },
  { key: "financeProvider",       header: "financeProvider",       kind: "text",    required: false, hint: "",                                     example: "",                   width: 16 },
  { key: "financeRef",            header: "financeRef",            kind: "text",    required: false, hint: "",                                     example: "",                   width: 16 },
] as const;

export const REQUIRED_KEYS = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key);
export const ALL_KEYS = IMPORT_COLUMNS.map((c) => c.key);
export const COLUMN_BY_KEY: Readonly<Record<string, ImportColumn>> = Object.fromEntries(
  IMPORT_COLUMNS.map((c) => [c.key, c]),
);
