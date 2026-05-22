import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { getBranding } from "@/lib/branding";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { CUSTOMER_IMPORT_COLUMNS } from "@/lib/validators/customer-import";
import { CUSTOMER_IMPORT_INSTRUCTIONS } from "@/server/services/customer-import";

const HEADERS = CUSTOMER_IMPORT_COLUMNS.map((c) => c.header);
const DATA_SHEET_NAME = "Customers";
const INSTRUCTIONS_SHEET_NAME = "Instructions";

function toDateString(value: Date | null | undefined): string {
  if (!value) return "";
  const iso = value.toISOString();
  return iso.slice(0, 10);
}

function buildWorkbook(rows: Array<Record<string, string | boolean>>): Buffer {
  const dataAoA: Array<Array<string | boolean>> = [
    [...HEADERS],
    ...rows.map((r) => HEADERS.map((h) => (h in r ? r[h] ?? "" : ""))),
  ];
  const dataSheet = XLSX.utils.aoa_to_sheet(dataAoA);
  dataSheet["!cols"] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  dataSheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  const instructionsSheet = XLSX.utils.aoa_to_sheet(CUSTOMER_IMPORT_INSTRUCTIONS);
  instructionsSheet["!cols"] = [{ wch: 28 }, { wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, dataSheet, DATA_SHEET_NAME);
  XLSX.utils.book_append_sheet(wb, instructionsSheet, INSTRUCTIONS_SHEET_NAME);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
}

export const GET = withAudit(
  { name: "api.staff.customers.export", entity: "CustomerExport" },
  handleGet,
);

async function handleGet(req: Request) {
  const session = await auth();
  if (
    !session?.user ||
    !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)
  ) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "all";
  if (mode !== "all" && mode !== "template") {
    return NextResponse.json(
      { error: "mode must be 'all' or 'template'" },
      { status: 400 },
    );
  }

  const { siteName } = await getBranding();
  const slug =
    siteName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export";

  const rows: Array<Record<string, string | boolean>> = [];
  let filename = `${slug}-customer-template.xlsx`;

  if (mode === "all") {
    filename = `${slug}-customers-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const customers = await prisma.user.findMany({
      where: { role: "CUSTOMER", deletedAt: null },
      include: { customerProfile: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    for (const u of customers) {
      const p = u.customerProfile;
      rows.push({
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone ?? "",
        dateOfBirth: toDateString(u.dateOfBirth ?? null),
        licenceNumber: p?.licenceNumber ?? "",
        licenceState: p?.licenceState ?? "",
        licenceExpiry: toDateString(p?.licenceExpiry ?? null),
        licenceClass: p?.licenceClass ?? "",
        passportNumber: p?.passportNumber ?? "",
        passportCountry: p?.passportCountry ?? "",
        passportExpiry: toDateString(p?.passportExpiry ?? null),
        emergencyContactName: p?.emergencyContactName ?? "",
        emergencyContactPhone: p?.emergencyContactPhone ?? "",
        emergencyContactRelationship: p?.emergencyContactRelationship ?? "",
        addressLine1: p?.addressLine1 ?? "",
        addressLine2: p?.addressLine2 ?? "",
        suburb: p?.suburb ?? "",
        state: p?.state ?? "",
        postcode: p?.postcode ?? "",
        country: p?.country ?? "",
        marketingOptIn: p?.marketingOptIn ?? false,
        marketingSmsOptIn: p?.marketingSmsOptIn ?? false,
        notes: p?.notes ?? "",
        riskRating: p?.riskRating ?? "",
        loyaltyTier: p?.loyaltyTier ?? "",
      });
    }
  }

  const buf = buildWorkbook(rows);
  const u8 = new Uint8Array(buf);
  return new NextResponse(new Blob([u8]), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
