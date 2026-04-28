import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withAudit } from "@/lib/with-audit";
import { getReport } from "@/lib/export/registry";
import { toCsv } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";
import { toPdfBuffer } from "@/lib/export/pdf";
import { type ExportMeta, type ExportBrand } from "@/lib/export";
import { getBranding } from "@/lib/branding";

export const GET = withAudit({ name: "api.admin.reports.export", entity: "ReportExport" }, handleGet);

async function handleGet(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const reportId = url.searchParams.get("report");
  const format = url.searchParams.get("format");

  if (!reportId || !format) {
    return new NextResponse("Missing report or format", { status: 400 });
  }
  if (!["csv", "xlsx", "pdf"].includes(format)) {
    return new NextResponse("Invalid format", { status: 400 });
  }

  const report = getReport(reportId);
  if (!report) {
    return new NextResponse(`Unknown report: ${reportId}`, { status: 404 });
  }

  const role = session.user.role;
  const allowedRoles = report.allowedRoles ?? ["ADMIN", "SUPER_ADMIN", "MANAGER"];
  if (!allowedRoles.includes(role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    if (k !== "report" && k !== "format") params[k] = v;
  });

  let input: unknown;
  try {
    input = report.inputSchema.parse(params);
  } catch (err) {
    return new NextResponse(`Invalid input: ${err instanceof Error ? err.message : "parse error"}`, { status: 400 });
  }

  if (role === "MANAGER") {
    const depotId = (input as { depotId?: string }).depotId;
    const sessionDepotId = session.user.depotId;
    if (!sessionDepotId || depotId !== sessionDepotId) {
      return new NextResponse("Managers must scope to their depot", { status: 403 });
    }
  }

  const result = await report.fetch(
    {
      userId: session.user.id ?? null,
      userRole: role,
      depotId: session.user.depotId ?? null,
    },
    input,
  );

  const branding = await getBranding();
  const brand: ExportBrand = {
    name: branding.siteName,
    abn: branding.abn,
    email: branding.supportEmail ?? "",
    website: "",
  };

  const meta: ExportMeta = {
    title: result.meta.title ?? report.title,
    subtitle: result.meta.subtitle,
    generatedAt: result.meta.generatedAt ?? new Date(),
    filters: result.meta.filters ?? [],
    brand,
  };

  const from = params.from ? params.from.slice(0, 10) : "all";
  const to = params.to ? params.to.slice(0, 10) : "all";
  const slug = (branding.siteName || "report").toLowerCase().replace(/\s+/g, "-");
  const baseFilename = `${slug}-${reportId}-${from}-to-${to}`;

  if (format === "csv") {
    const csv = toCsv(result.rows, report.columns);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseFilename}.csv"`,
      },
    });
  }

  if (format === "xlsx") {
    const buf = toXlsx(result.rows, report.columns, { sheetName: report.title.slice(0, 31), meta });
    const u8 = new Uint8Array(buf);
    return new NextResponse(new Blob([u8]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseFilename}.xlsx"`,
      },
    });
  }

  const pdfBuf = await toPdfBuffer({ meta, columns: report.columns, rows: result.rows });
  const pdfU8 = new Uint8Array(pdfBuf);
  return new NextResponse(new Blob([pdfU8]), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${baseFilename}.pdf"`,
    },
  });
}
