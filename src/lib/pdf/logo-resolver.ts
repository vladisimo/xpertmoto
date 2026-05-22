import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Branding } from "@/lib/branding";

const DEFAULT_PDF_LOGO = "/brand/xpert-logo-black.png";

// Operator-uploaded logos always come back from `uploadFile()` as either an
// http(s) URL (S3/MinIO, the production path) or a `/uploads/branding/{uuid}`
// string (the dev-mode local fallback in `src/lib/storage.ts`). The bundled
// default lives under `/brand/`. The two `resolveLocal*` helpers below inline
// their literal subdirectory into `join()` so Turbopack's static analyser sees
// `public/brand/<dynamic>` and `public/uploads/branding/<dynamic>` instead of
// `public/<dynamic>`, which would otherwise glob over the ~17K driver/vehicle
// uploads in `public/uploads/`.
function resolveLocalBrand(rel: string): string | null {
  const localPath = join(process.cwd(), "public", "brand", rel);
  if (existsSync(localPath)) return localPath;
  return null;
}

function resolveLocalBrandingUpload(rel: string): string | null {
  const localPath = join(process.cwd(), "public", "uploads", "branding", rel);
  if (existsSync(localPath)) return localPath;
  return null;
}

/**
 * Resolve a single logo URL to an `Image`-compatible source for
 * `@react-pdf/renderer`. Server-side only (relies on the filesystem).
 *
 * Handles three cases:
 * - Absolute http(s) URL → returned as-is.
 * - Relative path starting with `/` → resolved to a filesystem path
 *   under `public/`, returned only if the file actually exists. AVIF
 *   files are skipped because @react-pdf does not decode AVIF.
 * - Anything else (null, blank, unsupported scheme) → returns null and
 *   the caller falls back to the text wordmark.
 *
 * `data:` URIs are passed through; they're already PDF-safe.
 */
function resolveOne(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }
  // AVIF is not decoded by @react-pdf; skip before any filesystem probe.
  if (/\.avif$/i.test(trimmed)) return null;
  const BRAND_PREFIX = "/brand/";
  if (trimmed.startsWith(BRAND_PREFIX)) {
    return resolveLocalBrand(trimmed.slice(BRAND_PREFIX.length));
  }
  const UPLOAD_PREFIX = "/uploads/branding/";
  if (trimmed.startsWith(UPLOAD_PREFIX)) {
    return resolveLocalBrandingUpload(trimmed.slice(UPLOAD_PREFIX.length));
  }
  return null;
}

/**
 * Pick the best logo for a PDF page. Preference order:
 *
 *   1. Operator-uploaded `logoBlackUrl` (dark-on-transparent variant
 *      authored specifically for light surfaces).
 *   2. Operator-uploaded `logoWideUrl` (only readable here if it's
 *      itself dark-on-transparent — operators using a white-on-
 *      transparent wide logo will get an invisible mark and should
 *      upload the black variant).
 *   3. Bundled default `/brand/xpert-logo-black.png`.
 *   4. `null` — caller falls back to the text wordmark.
 *
 * Pass either a Branding object or, for back-compat with the original
 * single-arg signature, just a wide URL string.
 */
export function resolvePdfLogoSrc(
  input: Branding | string | null | undefined,
): string | null {
  if (!input || typeof input === "string") {
    return (
      resolveOne(typeof input === "string" ? input : null) ??
      resolveOne(DEFAULT_PDF_LOGO)
    );
  }
  return (
    resolveOne(input.logoBlackUrl) ??
    resolveOne(input.logoWideUrl) ??
    resolveOne(DEFAULT_PDF_LOGO)
  );
}
