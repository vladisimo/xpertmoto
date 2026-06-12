import { getReport } from "@/lib/export/registry";
import { toPdfBuffer } from "@/lib/export/pdf";
import { type ExportBrand, type ExportMeta } from "@/lib/export";
import { getBranding } from "@/lib/branding";

/**
 * Everything a report PDF render needs, in a JSON-serialisable shape so it
 * can ride a BullMQ job to the worker process. `params` are the raw
 * query-string values — re-validated through the report's inputSchema at
 * render time (Dates don't survive Redis serialisation, strings do).
 */
export type ReportRenderArgs = {
  reportId: string;
  params: Record<string, string>;
  ctx: { userId: string | null; userRole: string; depotId: string | null };
};

/**
 * Fetch + render a report PDF. Called from the report-export worker (the
 * normal path — react-pdf rendering is CPU-bound and would block the web
 * process's event loop) and inline from the export route when Redis is
 * unavailable. Authorisation is the caller's job: the route checks role /
 * depot scope before anything reaches here.
 */
export async function renderReportPdfBuffer(args: ReportRenderArgs): Promise<Buffer> {
  const report = getReport(args.reportId);
  if (!report) throw new Error(`Unknown report: ${args.reportId}`);
  const input = report.inputSchema.parse(args.params);
  const result = await report.fetch(args.ctx, input);

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

  return toPdfBuffer({ meta, columns: report.columns, rows: result.rows });
}
