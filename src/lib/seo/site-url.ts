/**
 * Single source of truth for the site's absolute public origin.
 *
 * Used by `metadataBase`, `robots.ts`, `sitemap.ts`, `manifest.ts` and OG image
 * URLs so every canonical / `og:url` / sitemap entry resolves to the same host.
 *
 * Reads `process.env` directly (not the validated `env` singleton) so it stays
 * usable from any runtime — RSC, route handlers, and tsx-run BullMQ jobs — and
 * mirrors the existing private `appBaseUrl()` precedent in
 * `src/lib/email-branding-vars.ts`. Never hardcodes a tenant domain
 * (multi-tenant rule — see `project_saas_architecture` memory).
 *
 * Resolution order, canonical-first (the public-facing origin wins):
 *   NEXT_PUBLIC_APP_URL → APP_URL → AUTH_URL → http://localhost:3000
 */
const FALLBACK_ORIGIN = "http://localhost:3000";

const firstNonEmpty = (...values: Array<string | undefined>): string | undefined =>
  values.find((v) => typeof v === "string" && v.trim().length > 0)?.trim();

export function getSiteUrl(): string {
  const candidate =
    firstNonEmpty(
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.APP_URL,
      process.env.AUTH_URL,
    ) ?? FALLBACK_ORIGIN;
  try {
    // `.origin` strips any trailing slash, path, query or hash for us.
    return new URL(candidate).origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

/**
 * Joins a root-relative path onto {@link getSiteUrl}. Absolute URLs are
 * returned untouched so callers can pass through CDN-hosted assets.
 */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getSiteUrl();
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}
