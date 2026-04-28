import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { headerIp, headerUserAgent } from "@/lib/request-meta";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Content-Security-Policy violation report endpoint.
 *
 * Accepts both the legacy `application/csp-report` body shape
 * (`{ "csp-report": {...} }`) and the newer Reporting API
 * `application/reports+json` array shape. Logs via Pino — which
 * already PII-redacts — and returns 204.
 *
 * No DB writes. Rate-limited per-IP so a malicious browser extension
 * can't flood us with junk reports.
 */
export async function POST(req: NextRequest) {
  const ip = headerIp(req.headers);
  const userAgent = headerUserAgent(req.headers);

  const limit = await rateLimit(`csp-report:ip:${ip ?? "unknown"}`, 200, 60);
  if (!limit.ok) {
    return new NextResponse(null, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  const reports = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && "csp-report" in body
      ? [(body as { "csp-report": unknown })["csp-report"]]
      : [body];

  for (const report of reports) {
    logger.warn({ csp: report, ip, userAgent }, "csp-report: violation");
  }

  return new NextResponse(null, { status: 204 });
}
