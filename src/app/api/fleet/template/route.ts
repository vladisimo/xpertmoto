import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { IMPORT_COLUMNS, IMPORTABLE_STATUSES } from "@/lib/fleet/import-columns";

const STATUS_DESCRIPTIONS: Record<(typeof IMPORTABLE_STATUSES)[number], string> = {
  AVAILABLE: "Listed and bookable (default when the column is empty).",
  PENDING: "In the fleet, not yet bookable — awaiting photos / inspection / rego.",
  IN_MAINTENANCE: "Off-road for scheduled service.",
  ACCIDENT_REPAIRS: "Off-road for damage repair.",
  SOLD: "Disposed: soft-deletes the vehicle. Record sale price in notes.",
  END_OF_LIFE: "Disposed: retired without sale. Soft-deletes the vehicle.",
  STOLEN: "Hard loss — future bookings will auto-reassign.",
  WRITTEN_OFF: "Hard loss — future bookings will auto-reassign.",
};

export const GET = withAudit(
  { name: "api.fleet.exportTemplate", entity: "Vehicle" },
  handleGet,
);

async function handleGet() {
  const session = await auth();
  if (!session?.user || !["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const [categories, depots] = await Promise.all([
    prisma.vehicleCategory.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { name: true, engineCapacity: true, licenceRequired: true },
    }),
    prisma.depot.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: { name: true, addressLine1: true, suburb: true, state: true },
    }),
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildVehiclesSheet(), "Vehicles");
  XLSX.utils.book_append_sheet(wb, buildLookupsSheet(categories, depots), "Lookups");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  const u8 = new Uint8Array(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));

  return new NextResponse(new Blob([u8]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="fleet-import-template.xlsx"',
    },
  });
}

function buildVehiclesSheet(): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};

  // Row 0: header
  // Row 1: REQUIRED / optional marker
  // Row 2: hint / format
  // Row 3: example
  IMPORT_COLUMNS.forEach((col, c) => {
    const headerAddr = XLSX.utils.encode_cell({ r: 0, c });
    const markerAddr = XLSX.utils.encode_cell({ r: 1, c });
    const hintAddr = XLSX.utils.encode_cell({ r: 2, c });
    const exampleAddr = XLSX.utils.encode_cell({ r: 3, c });

    const headerFill = col.required
      ? { fgColor: { rgb: "B91C1C" } }
      : { fgColor: { rgb: "1B6B4A" } };

    ws[headerAddr] = {
      v: col.header,
      t: "s",
      s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: headerFill },
    };
    ws[markerAddr] = {
      v: col.required ? "REQUIRED" : "optional",
      t: "s",
      s: {
        font: {
          sz: 9,
          bold: col.required,
          color: { rgb: col.required ? "B91C1C" : "666666" },
        },
      },
    };
    ws[hintAddr] = {
      v: col.hint,
      t: "s",
      s: { font: { sz: 9, italic: true, color: { rgb: "666666" } } },
    };
    ws[exampleAddr] = { v: col.example, t: "s", s: { font: { sz: 10 } } };
  });

  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: 3, c: IMPORT_COLUMNS.length - 1 },
  });
  ws["!cols"] = IMPORT_COLUMNS.map((col) => ({ wch: col.width ?? 16 }));
  ws["!freeze"] = { xSplit: 0, ySplit: 3 };

  return ws;
}

function buildLookupsSheet(
  categories: Array<{ name: string; engineCapacity: number; licenceRequired: string }>,
  depots: Array<{ name: string; addressLine1: string; suburb: string; state: string }>,
): XLSX.WorkSheet {
  const rows: unknown[][] = [];
  rows.push([
    "Copy exact values from this sheet into the 'categoryName', 'depotName' and 'status' columns of the Vehicles sheet.",
  ]);
  rows.push([]);
  rows.push(["Categories"]);
  const categoriesHeaderRow = rows.length + 1; // 1-based row number in the sheet
  rows.push(["categoryName", "engine (cc)", "licence required"]);
  categories.forEach((c) => rows.push([c.name, c.engineCapacity, c.licenceRequired]));
  rows.push([]);
  rows.push(["Depots"]);
  const depotsHeaderRow = rows.length + 1;
  rows.push(["depotName", "address", "suburb", "state"]);
  depots.forEach((d) => rows.push([d.name, d.addressLine1, d.suburb, d.state]));
  rows.push([]);
  rows.push(["Statuses"]);
  const statusesHeaderRow = rows.length + 1;
  rows.push(["status", "meaning"]);
  for (const s of IMPORTABLE_STATUSES) {
    rows.push([s, STATUS_DESCRIPTIONS[s]]);
  }
  rows.push([]);
  rows.push([
    "Note: RENTED, RESERVED and IN_TRANSIT are set automatically by the booking and transfer flows — rows with those statuses are rejected on import.",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Bold the section headings and their sub-headers.
  const boldRows = [
    ["A3"], // "Categories"
    ["A" + categoriesHeaderRow, "B" + categoriesHeaderRow, "C" + categoriesHeaderRow],
    ["A" + (categoriesHeaderRow + categories.length + 2)], // "Depots"
    ["A" + depotsHeaderRow, "B" + depotsHeaderRow, "C" + depotsHeaderRow, "D" + depotsHeaderRow],
    ["A" + (depotsHeaderRow + depots.length + 2)], // "Statuses"
    ["A" + statusesHeaderRow, "B" + statusesHeaderRow],
  ].flat();
  for (const addr of boldRows) {
    if (ws[addr]) {
      (ws[addr] as XLSX.CellObject).s = { font: { bold: true } };
    }
  }

  ws["!cols"] = [{ wch: 28 }, { wch: 56 }, { wch: 18 }, { wch: 8 }];
  return ws;
}
