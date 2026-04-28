import type { PrismaClient } from "@prisma/client";
import {
  AU_STATES,
  CONDITIONS,
  DEPRECIATION_METHODS,
  IMPORT_COLUMNS,
  IMPORTABLE_STATUSES,
  REQUIRED_KEYS,
} from "./import-columns";
import type { RawRow } from "./import-parse";

export type RowStatus = "ok" | "error" | "duplicate";

export interface VehiclePayload {
  internalCode: string;
  rego: string;
  regoState: string;
  make: string;
  model: string;
  year: number;
  colour: string;
  categoryId: string;
  depotId: string;
  vin?: string;
  engineNumber?: string;
  regoExpiry?: Date;
  currentOdometerKm?: number;
  fuelType?: string;
  status?: (typeof IMPORTABLE_STATUSES)[number];
  condition?: (typeof CONDITIONS)[number];
  notes?: string;
  purchaseDate?: Date;
  purchasePrice?: number;
  depreciationMethod?: (typeof DEPRECIATION_METHODS)[number];
  depreciationRate?: number;
  insurancePolicyNumber?: string;
  insuranceExpiry?: Date;
  ctpExpiry?: Date;
  warrantyExpiry?: Date;
  supplierName?: string;
  supplierContact?: string;
  financeType?: string;
  financeProvider?: string;
  financeRef?: string;
}

export interface ValidationRow {
  rowNumber: number;
  internalCode: string | null;
  rego: string | null;
  status: RowStatus;
  issues: string[];
  /** Present iff status === "ok". Ready to feed `bulkCreateVehicles`. */
  parsed?: VehiclePayload;
}

export interface ValidationSummary {
  ok: number;
  error: number;
  duplicate: number;
  total: number;
}

export interface ValidationResult {
  rows: ValidationRow[];
  summary: ValidationSummary;
  /** Only the `ok` rows' parsed payloads, in original row order. */
  payload: VehiclePayload[];
  /** Top-level errors, e.g. header mismatch. When non-empty, `rows` may be []. */
  topErrors: string[];
}

export interface ValidateContext {
  prisma: Pick<PrismaClient, "depot" | "vehicleCategory" | "vehicle">;
}

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1980;
const MAX_YEAR = CURRENT_YEAR + 1;

export async function validateVehicleRows(
  rawRows: RawRow[],
  rowNumbers: number[],
  ctx: ValidateContext,
  headerIssues?: { missing: string[]; unknown: string[] },
): Promise<ValidationResult> {
  const topErrors: string[] = [];
  if (headerIssues) {
    if (headerIssues.missing.length > 0) {
      topErrors.push(
        `Missing required columns: ${headerIssues.missing.join(", ")}. Re-download the template.`,
      );
    }
    if (headerIssues.unknown.length > 0) {
      topErrors.push(
        `Unknown columns in sheet: ${headerIssues.unknown.join(", ")}. Rename or remove them.`,
      );
    }
  }

  if (topErrors.length > 0 || rawRows.length === 0) {
    return {
      rows: [],
      summary: { ok: 0, error: 0, duplicate: 0, total: 0 },
      payload: [],
      topErrors,
    };
  }

  const [depots, categories] = await Promise.all([
    ctx.prisma.depot.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
    }),
    ctx.prisma.vehicleCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  const depotByName = new Map(depots.map((d) => [d.name.toLowerCase(), d.id]));
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const rows: ValidationRow[] = rawRows.map((raw, i) => {
    const issues: string[] = [];
    const parsed: Partial<VehiclePayload> = {};

    // 1. Required-field presence
    for (const key of REQUIRED_KEYS) {
      const v = raw[key];
      if (v === null || v === undefined || String(v).trim() === "") {
        issues.push(`Missing required: ${key}`);
      }
    }

    // 2. Per-column type coercion + enum checks
    for (const col of IMPORT_COLUMNS) {
      const v = raw[col.key];
      if (v === null || v === undefined || String(v).trim() === "") continue;

      switch (col.kind) {
        case "text": {
          const s = String(v).trim();
          // categoryName / depotName resolved below — skip here
          if (col.key !== "categoryName" && col.key !== "depotName") {
            (parsed as Record<string, unknown>)[col.key] = s;
          }
          break;
        }
        case "integer": {
          const n = Number(v);
          if (!Number.isFinite(n) || !Number.isInteger(n)) {
            issues.push(`${col.key}: "${v}" is not an integer`);
            break;
          }
          if (col.key === "year") {
            if (n < MIN_YEAR || n > MAX_YEAR) {
              issues.push(`year: ${n} is outside ${MIN_YEAR}–${MAX_YEAR}`);
              break;
            }
            parsed.year = n;
          } else if (col.key === "currentOdometerKm") {
            if (n < 0) {
              issues.push(`currentOdometerKm: must be ≥ 0`);
              break;
            }
            parsed.currentOdometerKm = n;
          }
          break;
        }
        case "number": {
          const n = Number(v);
          if (!Number.isFinite(n)) {
            issues.push(`${col.key}: "${v}" is not a number`);
            break;
          }
          (parsed as Record<string, unknown>)[col.key] = n;
          break;
        }
        case "date": {
          const d = coerceDate(v);
          if (!d) {
            issues.push(`${col.key}: "${v}" is not a valid date (use YYYY-MM-DD)`);
            break;
          }
          (parsed as Record<string, unknown>)[col.key] = d;
          break;
        }
        case "enum": {
          const s = String(v).trim().toUpperCase();
          if (!col.enumValues?.includes(s)) {
            issues.push(
              `${col.key}: "${v}" not in {${col.enumValues?.join(", ") ?? ""}}`,
            );
            break;
          }
          (parsed as Record<string, unknown>)[col.key] = s;
          break;
        }
      }
    }

    // 3. regoState extra check (already validated via enum above but ensure value present)
    if (parsed.regoState && !AU_STATES.includes(parsed.regoState as (typeof AU_STATES)[number])) {
      issues.push(`regoState: must be one of ${AU_STATES.join(", ")}`);
    }

    // 4. FK resolution
    const categoryName = raw.categoryName ? String(raw.categoryName).trim() : "";
    const depotName = raw.depotName ? String(raw.depotName).trim() : "";
    if (categoryName) {
      const id = categoryByName.get(categoryName.toLowerCase());
      if (!id) {
        issues.push(
          `categoryName: "${categoryName}" not found. Valid: ${[...categoryByName.keys()]
            .map((k) => categories.find((c) => c.name.toLowerCase() === k)?.name ?? k)
            .join(", ")}`,
        );
      } else {
        parsed.categoryId = id;
      }
    }
    if (depotName) {
      const id = depotByName.get(depotName.toLowerCase());
      if (!id) {
        issues.push(
          `depotName: "${depotName}" not found. Valid: ${depots.map((d) => d.name).join(", ")}`,
        );
      } else {
        parsed.depotId = id;
      }
    }

    const internalCode = typeof parsed.internalCode === "string" ? parsed.internalCode : null;
    const rego = typeof parsed.rego === "string" ? parsed.rego : null;

    const status: RowStatus = issues.length > 0 ? "error" : "ok";
    return {
      rowNumber: rowNumbers[i] ?? i + 1,
      internalCode,
      rego,
      status,
      issues,
      parsed: status === "ok" ? (parsed as VehiclePayload) : undefined,
    };
  });

  // 5. Within-file dupes
  const seenInternal = new Map<string, number>();
  const seenRego = new Map<string, number>();
  for (const row of rows) {
    if (!row.parsed) continue;
    const code = row.parsed.internalCode.toLowerCase();
    const regoKey = `${row.parsed.rego.toLowerCase()}|${row.parsed.regoState.toLowerCase()}`;
    const prevInternal = seenInternal.get(code);
    const prevRego = seenRego.get(regoKey);
    if (prevInternal !== undefined) {
      row.status = "duplicate";
      row.issues.push(`internalCode also appears on row ${prevInternal}`);
      row.parsed = undefined;
    } else {
      seenInternal.set(code, row.rowNumber);
    }
    if (prevRego !== undefined) {
      row.status = "duplicate";
      row.issues.push(`(rego, regoState) also appears on row ${prevRego}`);
      row.parsed = undefined;
    } else {
      seenRego.set(regoKey, row.rowNumber);
    }
  }

  // 6. Against-DB dupes (one batched query)
  const candidateInternal = rows
    .map((r) => r.parsed?.internalCode)
    .filter((v): v is string => !!v);
  const candidateRegoPairs = rows
    .map((r) => (r.parsed ? { rego: r.parsed.rego, regoState: r.parsed.regoState } : null))
    .filter((v): v is { rego: string; regoState: string } => !!v);

  if (candidateInternal.length > 0 || candidateRegoPairs.length > 0) {
    const existing = await ctx.prisma.vehicle.findMany({
      where: {
        OR: [
          ...(candidateInternal.length > 0 ? [{ internalCode: { in: candidateInternal } }] : []),
          ...(candidateRegoPairs.length > 0
            ? [
                {
                  OR: candidateRegoPairs.map((p) => ({
                    AND: [{ rego: p.rego }, { regoState: p.regoState }],
                  })),
                },
              ]
            : []),
        ],
      },
      select: { internalCode: true, rego: true, regoState: true },
    });
    const existingInternal = new Set(existing.map((e) => e.internalCode.toLowerCase()));
    const existingRego = new Set(
      existing.map((e) => `${e.rego.toLowerCase()}|${e.regoState.toLowerCase()}`),
    );
    for (const row of rows) {
      if (!row.parsed) continue;
      if (existingInternal.has(row.parsed.internalCode.toLowerCase())) {
        row.status = "duplicate";
        row.issues.push("internalCode already exists in the fleet");
        row.parsed = undefined;
        continue;
      }
      const regoKey = `${row.parsed.rego.toLowerCase()}|${row.parsed.regoState.toLowerCase()}`;
      if (existingRego.has(regoKey)) {
        row.status = "duplicate";
        row.issues.push("(rego, regoState) already exists in the fleet");
        row.parsed = undefined;
      }
    }
  }

  const summary: ValidationSummary = {
    ok: rows.filter((r) => r.status === "ok").length,
    error: rows.filter((r) => r.status === "error").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    total: rows.length,
  };

  const payload = rows.filter((r) => r.parsed).map((r) => r.parsed!) as VehiclePayload[];

  return { rows, summary, payload, topErrors: [] };
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    // Excel serial date
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + value * 86400000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Prefer ISO, fall back to en-AU style "DD/MM/YYYY" and "DD-MM-YYYY"
    const iso = new Date(trimmed);
    if (!Number.isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return iso;
    const auMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (auMatch) {
      const [, d, m, y] = auMatch;
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return Number.isNaN(iso.getTime()) ? null : iso;
  }
  return null;
}
