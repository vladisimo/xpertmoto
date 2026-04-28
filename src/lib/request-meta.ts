/**
 * Shared helpers for extracting request metadata (IP, user agent, request id)
 * from Next.js `Headers` objects. Used by the tRPC context, the page-view
 * layouts, and `with-audit` route wrappers so every audit row has consistent
 * `ipAddress` / `userAgent` / `reqId` values.
 */

import { randomUUID } from "node:crypto";

export function headerIp(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return undefined;
}

export function headerUserAgent(headers: Headers): string | undefined {
  return headers.get("user-agent") ?? undefined;
}

export function headerReqId(headers: Headers): string {
  return headers.get("x-request-id") ?? randomUUID();
}
