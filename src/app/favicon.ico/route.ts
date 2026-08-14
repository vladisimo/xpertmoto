import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getBranding } from "@/lib/branding";
import { logger } from "@/lib/logger";

/**
 * Root `/favicon.ico` (frontend-test-findings #2). Browsers request this path
 * unconditionally and without any HTML context, so the `<link rel="icon">`
 * emitted by the root layout never spares them the request — it 404'd on
 * every visit.
 *
 * Next's `favicon` file convention only accepts a real `.ico` in `app/`, so a
 * Route Handler answers instead: the operator-configured favicon from
 * branding when one is set (proxied, not redirected, so this path always
 * answers 200), otherwise the square brand mark bundled in `public/brand/`.
 * A PNG body at `/favicon.ico` is fine for every modern browser.
 */

const CACHE_CONTROL = "public, max-age=86400";
const UPSTREAM_TIMEOUT_MS = 3_000;

function imageResponse(body: BodyInit, contentType: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
  });
}

/**
 * `branding.faviconUrl` already falls back to the square logo (see
 * src/lib/branding.ts), so this is the single tenant-configured source.
 * Any failure returns null and lets the caller serve the bundled asset —
 * a favicon must never 500 the request.
 */
async function fromBranding(): Promise<NextResponse | null> {
  let url: string | null = null;
  try {
    url = (await getBranding()).faviconUrl;
  } catch (err) {
    logger.warn({ err }, "favicon: branding read failed, using bundled asset");
  }
  if (!url) return null;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type");
    if (!res.ok || !contentType?.startsWith("image/")) {
      logger.warn(
        { status: res.status, contentType },
        "favicon: unusable branding asset, using bundled asset",
      );
      return null;
    }
    return imageResponse(await res.arrayBuffer(), contentType);
  } catch (err) {
    logger.warn({ err }, "favicon: branding asset fetch failed, using bundled asset");
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  const configured = await fromBranding();
  if (configured) return configured;

  try {
    // Literal segments, not a spread array: Turbopack resolves this path at
    // build time, and a dynamic argument reads as open-ended filesystem
    // access — which traces every source file and all of `public/` into the
    // server bundle. The only square asset in `public/brand/`.
    const bytes = await readFile(
      path.join(process.cwd(), "public", "brand", "xpert-logo-white-square.png"),
    );
    return imageResponse(new Uint8Array(bytes), "image/png");
  } catch (err) {
    logger.error({ err }, "favicon: bundled fallback asset is unreadable");
    return new NextResponse(null, { status: 404 });
  }
}
