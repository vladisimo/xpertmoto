/**
 * Identity image columns store raw S3 keys (e.g. "drivers/u1/file.jpg").
 * next/image needs a leading "/" or an absolute URL, and direct MinIO/S3 URLs
 * fail in dev (unreachable from remote clients) and are blocked by CSP in
 * prod. Route bytes through the same-origin /api/identity-image proxy, which
 * enforces auth and is CSP-safe.
 */
export function resolveIdentityImageSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return `/api/identity-image?key=${encodeURIComponent(raw)}`;
}
