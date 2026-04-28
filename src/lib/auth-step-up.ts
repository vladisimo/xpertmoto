import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

/**
 * Server-side guard for protected layouts. Returns the session if the user
 * is fully signed in. If the session is anonymous, redirects to `/login`
 * (carrying the requested path as `callbackUrl`). If the session is in the
 * `pending2fa` state — set when an OAuth or magic-link sign-in lands on a
 * user with TOTP enrolled — redirects to `/verify-2fa-step-up?next=...`,
 * which holds the user until they complete the TOTP mutation.
 *
 * Use this in every authenticated layout instead of bare `auth()` so the
 * step-up gate cannot be bypassed by deep-linking past the layout that
 * forgot to enforce it.
 *
 * @returns A `Session` whose `pending2fa` is guaranteed to be falsy. The
 *   return type is therefore the original Session type — callers should
 *   not need to re-check `pending2fa`.
 */
export async function requireFullSession(opts: {
  /** Path the user requested. Sent back via callbackUrl / next so the
   *  user lands where they were trying to go after auth completes. */
  pathname?: string;
} = {}): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    const next = opts.pathname
      ? `?callbackUrl=${encodeURIComponent(opts.pathname)}`
      : "";
    redirect(`/login${next}`);
  }
  if (session.pending2fa === true) {
    const next = opts.pathname
      ? `?next=${encodeURIComponent(opts.pathname)}`
      : "";
    redirect(`/verify-2fa-step-up${next}`);
  }
  return session;
}
