import { NextResponse, type NextRequest } from "next/server";
import { getBranding } from "@/lib/branding";

/**
 * RFC 9116 security.txt. Reached at `/.well-known/security.txt` via the
 * rewrite in next.config.mjs. The security contact is read from branding
 * (`getBranding()`) rather than hardcoded — see src/lib/CLAUDE.md — and
 * falls back to `security@<host>` when no support/privacy email is set so
 * the mandatory `Contact:` field is always present.
 *
 * `Expires` is recomputed on each read (~1 year ahead). The response is
 * cacheable for a day; an out-of-date `Expires` only triggers a re-fetch,
 * never a hard failure.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const branding = await getBranding();
  const { origin, hostname } = req.nextUrl;

  const contact =
    branding.privacyEmail ?? branding.supportEmail ?? `security@${hostname}`;

  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const body = [
    `Contact: mailto:${contact}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/privacy`,
    "",
  ].join("\n");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
