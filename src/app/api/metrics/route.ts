import { NextResponse } from "next/server";
import { metrics } from "@/server/services/metrics";
import { getSecret } from "@/lib/integration-config";
import { logger } from "@/lib/logger";

/**
 * G14 — Prometheus scrape endpoint.
 *
 * Authentication: bearer token from SystemSetting `metrics:scrapeToken`
 * (or env `METRICS_SCRAPE_TOKEN`). Do NOT expose without a token — payment
 * volume / success rates are sensitive commercial data.
 *
 * Scrape pattern (Prometheus config):
 *
 *   scrape_configs:
 *     - job_name: 'xpertmoto'
 *       metrics_path: '/api/metrics'
 *       bearer_token_file: /etc/prometheus/xpertmoto-token
 *       static_configs:
 *         - targets: ['xpertmoto.com.au']
 *
 * Returns 503 when no token is configured so we fail closed, not open.
 *
 * This handler reads `req.headers` which Next 16's `cacheComponents` mode
 * already treats as a dynamic signal, so no explicit opt-out is needed
 * (and `export const dynamic = "force-dynamic"` is now rejected by the
 * compiler when `cacheComponents: true` is set in next.config.mjs).
 */

export async function GET(req: Request): Promise<Response> {
  const token = await getSecret("metrics:scrapeToken", "METRICS_SCRAPE_TOKEN");
  if (!token) {
    return new NextResponse("Metrics scrape not configured", { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  if (auth !== expected) {
    logger.warn({ path: "/api/metrics" }, "metrics scrape rejected: bad token");
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const body = metrics.format();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
