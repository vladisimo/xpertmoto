/**
 * One-off migration: wipe the Vehicle table and re-import the real fleet
 * from a myFleetManager CSV export, with matching PNG images.
 *
 * Usage:
 *   npm run import:fleet -- --csv ./data/vehicles.csv --images ./data/vehicle-image
 *
 * The CSV must have these columns:
 *   rego, car_id, status, registered_state, year, expiry_date, odometer,
 *   make_model, vin, engine_number
 *
 * Images are discovered by matching `<rego>.png` (case-insensitive) under
 * the --images directory. Missing images are logged, not fatal.
 */

import { readFile } from "fs/promises";
import { existsSync, statSync, readdirSync } from "fs";
import path from "path";
import Papa from "papaparse";
import { PrismaClient, type Prisma } from "@prisma/client";
import { validateVehicleRows, type VehiclePayload } from "../src/lib/fleet/import-validate";
import type { RawRow } from "../src/lib/fleet/import-parse";
import { DISPOSITION_STATUSES } from "../src/server/trpc/router/fleet";
import { uploadFile } from "../src/lib/storage";

const STATUS_MAP: Record<string, VehiclePayload["status"]> = {
  "": "AVAILABLE",
  "active": "AVAILABLE",
  "sold": "SOLD",
  "stolen": "STOLEN",
  "accident repairs": "ACCIDENT_REPAIRS",
  "vehicle service": "IN_MAINTENANCE",
  "write-off": "WRITTEN_OFF",
};

const DEPOT_NAME = "Scootering Lewisham";
const DEFAULT_COLOUR = "Unknown";
const LAMS = "LAMS Motorcycle";
const UNRESTRICTED = "Unrestricted Motorcycle";
const UTILITY = "Utility Vehicle";

/**
 * Step-through / CVT scooters — these get the `SCT-` prefix. Everything
 * else on two wheels gets `MTB-`, and the Ford Transit gets `UTL-`. Keys
 * are the same normalised `make_model` strings used in `MODEL_TO_CATEGORY`.
 */
const SCOOTER_MODELS = new Set<string>([
  "honda - nsc110 dio",
  "yamaha - nmax155",
  "honda - sh150",
  "yamaha - xmax300",
  "yamaha - y-dlight",
]);

function internalCodePrefix(modelKey: string, category: string): "SCT" | "MTB" | "UTL" {
  if (category === UTILITY) return "UTL";
  if (SCOOTER_MODELS.has(modelKey)) return "SCT";
  return "MTB";
}

/**
 * Hand-mapped lookup from normalised `make_model` string → category name.
 * Keys are lowercased and trimmed. Any CSV model not in this table causes a
 * hard error — we never silently guess a category.
 *
 * Bucketing rationale: LAMS-approved bikes (power-to-weight ≤ 150 kW/tonne
 * and engine ≤ 660cc) → LAMS. Everything above → Unrestricted. The Ford
 * Transit is the only utility vehicle.
 */
const MODEL_TO_CATEGORY: Record<string, string> = {
  // --- Scooters (all LAMS) ---
  "honda - nsc110 dio": LAMS,
  "yamaha - nmax155": LAMS,
  "honda - sh150": LAMS,
  "yamaha - xmax300": LAMS,
  "yamaha - y-dlight": LAMS,
  "honda - cb125e": LAMS,
  "honda - cb125f": LAMS,

  // --- Small/mid bikes (LAMS) ---
  "honda - cb300r": LAMS,
  "honda - cbr300r": LAMS,
  "honda - cb500f": LAMS,
  "honda - cb500x": LAMS,
  "honda - cbr500r": LAMS,
  "yamaha - mt03": LAMS,
  "yamaha - r3": LAMS,
  "yamaha - r15m": LAMS,
  "yamaha - mt07": LAMS,
  "yamaha - r7": LAMS,
  "suzuki - gsx250r": LAMS,
  "kawasaki - ninja 650": LAMS,
  "kawasaki - vulcan s": LAMS,
  "ktm - duke 200": LAMS,
  "ktm - duke 390": LAMS,
  "ktm - rc 390": LAMS,
  "ktm - 390 adventure": LAMS,
  "cfmoto - 300cl-x": LAMS,
  "cfmoto - 150nk": LAMS,
  "cfmoto - 450nk": LAMS,
  "royal enfield - himalayan 450": LAMS,
  "bmw - g310r": LAMS,
  "honda - cb500": LAMS,

  // --- Unrestricted / full power ---
  "kawasaki - klr 650 adventure": UNRESTRICTED,
  "bmw - f 750 gs triple black": UNRESTRICTED,
  "cfmoto - 700cl-x sport": UNRESTRICTED,
  "cfmoto - 800mt": UNRESTRICTED,
  "triumph - trident 660": UNRESTRICTED,
  "harley davidson - xl883l": UNRESTRICTED,
  "harley davidson - sportster s": UNRESTRICTED,
  "ducati - monster 659": UNRESTRICTED,
  "ducati - monster 937": UNRESTRICTED,
  "honda - cbr1000rr fireblade repsol edition": UNRESTRICTED,
  "honda - cb1000r": UNRESTRICTED,
  "yamaha - mt09": UNRESTRICTED,
  "yamaha - tenere 700": UNRESTRICTED,
  "yamaha - wr450": UNRESTRICTED,
  "yamaha - wr450f": UNRESTRICTED,
  "bmw - r1250 gs trophy": UNRESTRICTED,
  "bmw - r1300 gs trophy": UNRESTRICTED,
  "renault - master": UNRESTRICTED,

  // --- Utility ---
  "ford - transit connect": UTILITY,
};

interface Args {
  csv: string;
  images: string;
}

function parseArgs(argv: string[]): Args {
  let csv = "./data/vehicles.csv";
  let images = "./data/vehicle-image";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--csv" && argv[i + 1]) csv = argv[++i]!;
    else if (argv[i] === "--images" && argv[i + 1]) images = argv[++i]!;
  }
  return { csv, images };
}

function normalise(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}

function coerceOdometer(v: unknown): string | undefined {
  const s = normalise(v);
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return String(Math.floor(n));
}

function plausibleVin(v: unknown): string | undefined {
  const s = normalise(v);
  if (!s) return undefined;
  if (s.length < 5) return undefined;
  if (/[*X]/i.test(s)) return undefined;
  if (/^0+$/.test(s)) return undefined;
  return s;
}

interface LegacyRow {
  rego: string;
  car_id: string;
  status: string;
  registered_state: string;
  year: string;
  expiry_date: string;
  odometer: string;
  make_model: string;
  vin: string;
  engine_number: string;
  [key: string]: string;
}

function buildRawRow(row: LegacyRow, lineNumber: number): { raw: RawRow; error?: string } {
  const makeModel = normalise(row.make_model);
  const modelKey = makeModel.toLowerCase();
  const category = MODEL_TO_CATEGORY[modelKey];
  if (!category) {
    return {
      raw: {},
      error: `line ${lineNumber}: unmapped model "${makeModel}" — add it to MODEL_TO_CATEGORY`,
    };
  }

  const [makeRaw, ...rest] = makeModel.split(" - ");
  const make = (makeRaw ?? "").trim() || "Unknown";
  const model = rest.join(" - ").trim() || makeModel;

  const statusKey = normalise(row.status).toLowerCase();
  const mappedStatus = STATUS_MAP[statusKey];
  if (mappedStatus === undefined) {
    return {
      raw: {},
      error: `line ${lineNumber}: unknown status "${row.status}"`,
    };
  }

  const raw: RawRow = {
    internalCode: `${internalCodePrefix(modelKey, category)}-${normalise(row.car_id)}`,
    rego: normalise(row.rego).toUpperCase(),
    regoState: normalise(row.registered_state).toUpperCase(),
    make,
    model,
    year: normalise(row.year),
    colour: DEFAULT_COLOUR,
    categoryName: category,
    depotName: DEPOT_NAME,
    status: mappedStatus,
  };

  const vin = plausibleVin(row.vin);
  if (vin) raw.vin = vin;

  const expiry = normalise(row.expiry_date);
  if (expiry) raw.regoExpiry = expiry;

  const odo = coerceOdometer(row.odometer);
  if (odo) raw.currentOdometerKm = odo;

  return { raw };
}

function buildImageIndex(dir: string): Map<string, string> {
  const idx = new Map<string, string>();
  if (!existsSync(dir)) return idx;
  const stat = statSync(dir);
  if (!stat.isDirectory()) return idx;
  for (const entry of readdirSync(dir)) {
    const ext = path.extname(entry).toLowerCase();
    if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg" && ext !== ".webp") continue;
    const base = path.basename(entry, path.extname(entry)).toUpperCase();
    idx.set(base, path.join(dir, entry));
  }
  return idx;
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

interface WipeResult {
  vehiclesWiped: number;
  depotsWiped: number;
  demoUsersWiped: number;
}

/**
 * Wipe all demo/test data that either references vehicles or would leave
 * dangling references to depots/users/vehicles after the migration.
 *
 * Keeps: Organisation, Lewisham depot, categories, addons, insurance
 * options, seasons, system settings, real staff/admin users (non-@example
 * and not assigned to a departing depot).
 */
async function wipeDemoData(prisma: PrismaClient): Promise<WipeResult> {
  const vehiclesWiped = await prisma.vehicle.count();
  const lewisham = await prisma.depot.findFirst({
    where: { slug: "lewisham" },
    select: { id: true },
  });
  if (!lewisham) {
    throw new Error(
      "Lewisham depot not found. Run `npm run db:reset:demo` first to seed the single-depot baseline.",
    );
  }

  // Non-Lewisham depots we'll remove, plus their OneWayFee rows.
  const staleDepots = await prisma.depot.findMany({
    where: { id: { not: lewisham.id } },
    select: { id: true },
  });
  const staleDepotIds = staleDepots.map((d) => d.id);

  await prisma.$transaction([
    // --- Booking lifecycle ---
    prisma.bookingAddon.deleteMany(),
    prisma.bookingInsurance.deleteMany(),
    prisma.bookingNote.deleteMany(),
    prisma.bookingStatusLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.creditNote.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.bondLedger.deleteMany(),
    prisma.dailyRevenue.deleteMany(),
    prisma.booking.deleteMany(),

    // --- Inspections, maintenance, incidents ---
    prisma.inspectionPhoto.deleteMany(),
    prisma.inspectionItem.deleteMany(),
    prisma.inspection.deleteMany(),

    prisma.maintenancePart.deleteMany(),
    prisma.maintenanceLog.deleteMany(),
    prisma.maintenanceWorkOrder.deleteMany(),
    prisma.maintenanceSchedule.deleteMany(),

    prisma.incidentPhoto.deleteMany(),
    prisma.incidentDocument.deleteMany(),
    prisma.incidentNote.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.infringement.deleteMany(),

    // --- Vehicles (cascades remaining VehicleImage/Document/StatusLog) ---
    prisma.vehicleImage.deleteMany(),
    prisma.vehicleDocument.deleteMany(),
    prisma.vehicleStatusLog.deleteMany(),
    prisma.vehicleTransfer.deleteMany(),
    prisma.vehicle.deleteMany(),

    // --- Operational logs referencing deleted entities ---
    prisma.notification.deleteMany(),
    prisma.communicationLog.deleteMany(),
    prisma.auditLog.deleteMany(),

    // --- Depot-scoped configuration for stale depots ---
    prisma.oneWayFee.deleteMany(),
  ]);

  // Demo customers (all seed-generated @example.com users).
  const demoCustomers = await prisma.user.findMany({
    where: { email: { endsWith: "@example.com" } },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.customerProfile.deleteMany({
      where: { userId: { in: demoCustomers.map((u) => u.id) } },
    }),
    prisma.staffProfile.deleteMany({
      where: { userId: { in: demoCustomers.map((u) => u.id) } },
    }),
    prisma.account.deleteMany({
      where: { userId: { in: demoCustomers.map((u) => u.id) } },
    }),
    prisma.session.deleteMany({
      where: { userId: { in: demoCustomers.map((u) => u.id) } },
    }),
    prisma.user.deleteMany({
      where: { id: { in: demoCustomers.map((u) => u.id) } },
    }),
  ]);

  // Sanitise non-Lewisham depots and any staff bound to them.
  if (staleDepotIds.length > 0) {
    const staleStaff = await prisma.user.findMany({
      where: { depotId: { in: staleDepotIds } },
      select: { id: true },
    });
    const staleStaffIds = staleStaff.map((u) => u.id);
    await prisma.$transaction([
      prisma.staffProfile.deleteMany({ where: { userId: { in: staleStaffIds } } }),
      prisma.account.deleteMany({ where: { userId: { in: staleStaffIds } } }),
      prisma.session.deleteMany({ where: { userId: { in: staleStaffIds } } }),
      prisma.user.deleteMany({ where: { id: { in: staleStaffIds } } }),
      // Null nullable depot FKs on remaining tables that may still point at
      // the stale depots (cascade-free nullables).
      prisma.season.updateMany({
        where: { depotId: { in: staleDepotIds } },
        data: { depotId: null },
      }),
      prisma.addon.updateMany({
        where: { depotId: { in: staleDepotIds } },
        data: { depotId: null },
      }),
      prisma.pricingRule.updateMany({
        where: { depotId: { in: staleDepotIds } },
        data: { depotId: null },
      }),
      // DepotOperatingHours cascades on Depot delete.
      prisma.depot.deleteMany({ where: { id: { in: staleDepotIds } } }),
    ]);
  }

  return {
    vehiclesWiped,
    depotsWiped: staleDepotIds.length,
    demoUsersWiped: demoCustomers.length,
  };
}

async function main() {
  const { csv: csvPath, images: imagesDir } = parseArgs(process.argv.slice(2));

  if (!existsSync(csvPath)) {
    console.error(`❌ CSV not found: ${csvPath}`);
    process.exit(1);
  }
  if (!existsSync(imagesDir)) {
    console.warn(`⚠️  Images directory not found: ${imagesDir} — continuing without images`);
  }

  console.log(`📄 CSV:     ${path.resolve(csvPath)}`);
  console.log(`🖼  Images: ${path.resolve(imagesDir)}`);

  const csvText = await readFile(csvPath, "utf8");
  const parsed = Papa.parse<LegacyRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    console.error("❌ CSV parse errors:");
    for (const e of parsed.errors.slice(0, 10)) {
      console.error(`   row ${e.row}: ${e.code} — ${e.message}`);
    }
    process.exit(1);
  }

  const rawRows: RawRow[] = [];
  const rowNumbers: number[] = [];
  const transformErrors: string[] = [];

  parsed.data.forEach((row, i) => {
    if (!normalise(row.rego)) return;
    const lineNumber = i + 2;
    const { raw, error } = buildRawRow(row, lineNumber);
    if (error) {
      transformErrors.push(error);
      return;
    }
    rawRows.push(raw);
    rowNumbers.push(lineNumber);
  });

  if (transformErrors.length > 0) {
    console.error(`❌ ${transformErrors.length} row(s) could not be transformed:`);
    for (const e of transformErrors.slice(0, 20)) console.error(`   ${e}`);
    process.exit(1);
  }

  // Within-file VIN deduplication (case-insensitive). Vehicle.vin is @unique
  // at the DB level, so duplicates (often legacy data entry errors like the
  // same asset recorded twice under different regos) get their VIN dropped
  // on subsequent rows — the row still imports, just without a VIN.
  const seenVin = new Map<string, number>();
  const vinClashes: Array<{ line: number; rego: string; vin: string; firstLine: number }> = [];
  rawRows.forEach((raw, idx) => {
    const vin = raw.vin;
    if (typeof vin !== "string" || !vin) return;
    const key = vin.toUpperCase();
    const firstLine = seenVin.get(key);
    if (firstLine !== undefined) {
      vinClashes.push({
        line: rowNumbers[idx] ?? idx,
        rego: typeof raw.rego === "string" ? raw.rego : "?",
        vin,
        firstLine,
      });
      delete raw.vin;
    } else {
      seenVin.set(key, rowNumbers[idx] ?? idx);
    }
  });

  if (vinClashes.length > 0) {
    console.warn(`⚠️  ${vinClashes.length} within-file VIN duplicate(s) — VIN dropped on later rows:`);
    for (const c of vinClashes) {
      console.warn(`   line ${c.line} (${c.rego}) shares VIN "${c.vin}" with line ${c.firstLine}`);
    }
  }

  console.log(`✓ Parsed ${rawRows.length} rows from CSV`);

  const prisma = new PrismaClient();

  // Wipe first so validation runs against a clean fleet. If validation fails
  // after this point, the DB is left in a clean state — re-running after
  // fixing the CSV will simply wipe (nothing) and try again.
  const wipe = await wipeDemoData(prisma);
  console.log(
    `🧹 Sanitised: ${wipe.vehiclesWiped} vehicle(s), ${wipe.depotsWiped} stale depot(s), ${wipe.demoUsersWiped} demo customer(s), plus all dependent data`,
  );

  const validation = await validateVehicleRows(rawRows, rowNumbers, { prisma });

  if (validation.topErrors.length > 0) {
    console.error("❌ Top-level errors:");
    for (const e of validation.topErrors) console.error(`   ${e}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const badRows = validation.rows.filter((r) => r.status !== "ok");
  if (badRows.length > 0) {
    console.error(`❌ ${badRows.length} row(s) failed validation:`);
    for (const r of badRows.slice(0, 30)) {
      console.error(`   line ${r.rowNumber} (${r.internalCode ?? "?"} / ${r.rego ?? "?"}): ${r.issues.join("; ")}`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`✓ All ${validation.payload.length} rows validated`);

  // Re-run dupe detection now that the table is empty (validation ran before
  // the wipe, so any "duplicate against DB" hits would have been spurious —
  // but we already wipe so this is defensive).
  const byCategory = new Map<string, number>();

  await prisma.$transaction(async (tx) => {
    for (const payload of validation.payload) {
      const { status, categoryId, depotId, ...rest } = payload;
      const initialStatus = status ?? "AVAILABLE";
      const isDisposed = (DISPOSITION_STATUSES as readonly string[]).includes(initialStatus);

      const data: Prisma.VehicleCreateInput = {
        ...rest,
        category: { connect: { id: categoryId } },
        depot: { connect: { id: depotId } },
        status: initialStatus,
        currentBookValue: payload.purchasePrice ?? null,
        isActive: !isDisposed,
        deletedAt: isDisposed ? new Date() : null,
        statusLog: {
          create: {
            newStatus: initialStatus,
            reason: "Bulk import from legacy fleet CSV",
          },
        },
      };

      await tx.vehicle.create({ data, select: { id: true } });
    }

    // Count per category (using the name we mapped in buildRawRow — we have
    // the ID here, so look it up once from the payload).
    const categoryIds = [...new Set(validation.payload.map((p) => p.categoryId))];
    const categories = await tx.vehicleCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    for (const p of validation.payload) {
      const name = nameById.get(p.categoryId) ?? "Unknown";
      byCategory.set(name, (byCategory.get(name) ?? 0) + 1);
    }
  });

  console.log(`✓ Inserted ${validation.payload.length} vehicles`);

  // --- Image upload pass (post-DB-commit; failures don't block the import) ---
  const imageIndex = buildImageIndex(imagesDir);
  let uploaded = 0;
  let missing = 0;
  const uploadFailures: string[] = [];

  const createdVehicles = await prisma.vehicle.findMany({
    select: { id: true, rego: true, internalCode: true },
  });

  for (const v of createdVehicles) {
    const file = imageIndex.get(v.rego.toUpperCase());
    if (!file) {
      missing++;
      continue;
    }
    try {
      const body = await readFile(file);
      const { url } = await uploadFile({
        folder: `vehicles/${v.internalCode}`,
        filename: path.basename(file),
        contentType: contentTypeFor(file),
        body,
      });
      await prisma.vehicleImage.create({
        data: {
          vehicleId: v.id,
          url,
          isPrimary: true,
          displayOrder: 0,
        },
      });
      uploaded++;
    } catch (err) {
      uploadFailures.push(
        `${v.rego}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  Fleet import complete");
  console.log("═══════════════════════════════════════════");
  console.table({
    vehiclesWiped: wipe.vehiclesWiped,
    depotsWiped: wipe.depotsWiped,
    demoUsersWiped: wipe.demoUsersWiped,
    imported: validation.payload.length,
    imagesUploaded: uploaded,
    imagesMissing: missing,
    imageUploadFailures: uploadFailures.length,
  });
  console.log("Per-category breakdown:");
  console.table(Object.fromEntries(byCategory));

  if (uploadFailures.length > 0) {
    console.warn(`⚠️  ${uploadFailures.length} image upload(s) failed:`);
    for (const f of uploadFailures.slice(0, 10)) console.warn(`   ${f}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});
