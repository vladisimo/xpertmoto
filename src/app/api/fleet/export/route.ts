import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { VehicleStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { IMPORT_COLUMNS } from "@/lib/fleet/import-columns";

export const GET = withAudit({ name: "api.fleet.export", entity: "Vehicle" }, handleGet);

async function handleGet(req: Request) {
  const session = await auth();
  if (!session?.user || !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const depotId = url.searchParams.get("depotId") ?? undefined;

  const vehicles = await prisma.vehicle.findMany({
    where: {
      isActive: true,
      ...(status ? { status: status as VehicleStatus } : {}),
      ...(depotId ? { depotId } : {}),
      ...(q
        ? {
            OR: [
              { internalCode: { contains: q, mode: "insensitive" } },
              { rego: { contains: q, mode: "insensitive" } },
              { make: { contains: q, mode: "insensitive" } },
              { model: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { category: true, depot: true },
    orderBy: { internalCode: "asc" },
  });

  const aoa: unknown[][] = [];
  aoa.push(IMPORT_COLUMNS.map((c) => c.header));
  for (const v of vehicles) {
    aoa.push(
      IMPORT_COLUMNS.map((c) => {
        switch (c.key) {
          case "categoryName":
            return v.category.name;
          case "depotName":
            return v.depot.name;
          case "purchasePrice":
            return v.purchasePrice !== null ? Number(v.purchasePrice) : "";
          case "depreciationRate":
            return v.depreciationRate !== null ? Number(v.depreciationRate) : "";
          case "regoExpiry":
          case "purchaseDate":
          case "insuranceExpiry":
          case "ctpExpiry":
          case "warrantyExpiry": {
            const d = (v as unknown as Record<string, Date | null>)[c.key];
            return d ? d.toISOString().slice(0, 10) : "";
          }
          default: {
            const raw = (v as unknown as Record<string, unknown>)[c.key];
            return raw ?? "";
          }
        }
      }),
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  IMPORT_COLUMNS.forEach((_, c) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) {
      (ws[addr] as XLSX.CellObject).s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1B6B4A" } },
      };
    }
  });
  ws["!cols"] = IMPORT_COLUMNS.map((c) => ({ wch: c.width ?? 16 }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vehicles");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
  const u8 = new Uint8Array(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));
  const datestamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Blob([u8]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fleet-${datestamp}.xlsx"`,
    },
  });
}
