import { NextResponse } from "next/server";
import { signIn, signOut } from "@/lib/auth";

/**
 * GET /api/impersonate?token=... — consumes a one-shot impersonation
 * handoff token minted by tRPC `impersonation.start` (superAdmin only).
 * Delegates to NextAuth's "impersonate" Credentials provider which
 * verifies the HMAC signature and issues a fresh session for the target
 * user, with `impersonatorId` embedded.
 *
 * Admin flow:
 *   1. Admin clicks "View as customer" → `impersonation.start` returns
 *      `{ token }`.
 *   2. Client opens `/api/impersonate?token=...` — this route.
 *   3. NextAuth signs the admin out of their own session and signs them
 *      back in as the target user. The impersonation banner renders on
 *      every page until `/api/impersonate/stop` is hit.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  try {
    await signIn("impersonate", {
      token,
      redirect: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sign-in failed" },
      { status: 400 },
    );
  }
  return NextResponse.redirect(new URL("/dashboard", req.url));
}

/**
 * POST /api/impersonate/stop — ends the impersonation session. We just
 * sign the user out, returning the admin to /login. The admin can
 * then sign back in with their own credentials.
 *
 * Same-origin guard: without it, a cross-origin form could coerce the
 * browser into calling this route (NextAuth's session cookie ships with
 * SameSite=lax which permits top-level POSTs in some browsers), forcing
 * a logged-in user to sign out. Fetch API cross-origin POSTs set
 * `Sec-Fetch-Site: cross-site`; simple forms omit the Origin header but
 * set a non-same-origin Referer. We accept only same-origin callers.
 */
export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const site = req.headers.get("sec-fetch-site");
  const sameOrigin =
    site === "same-origin" ||
    (origin != null && host != null && new URL(origin).host === host);
  if (!sameOrigin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await signOut({ redirect: false });
  return NextResponse.json({ ok: true });
}
