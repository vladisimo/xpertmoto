"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { trpc } from "@/lib/trpc/client";

/**
 * Attaches the signed-in user to the Sentry scope so every client-side event
 * — unhandled errors, on-error session replays, performance traces — carries
 * the user, not just the per-request enrichment the tRPC middleware adds
 * server-side (trpc.ts).
 *
 * Identity comes from the same lightweight `session.whoAmI` query
 * `PostHogIdentify` uses, so it works from the root layout without a
 * NextAuth `<SessionProvider>` and TanStack Query dedupes the two callers.
 *
 * APP-conscious: we set only the stable user id plus role/impersonation tags
 * — never email, name, or any PII from the browser. Anonymous visitors resolve
 * `null` (whoAmI is a publicProcedure); we clear the scope on null and on
 * error so a prior user's id never leaks onto a later anonymous session on
 * the same tab.
 */
export function SentryIdentify() {
  const { data, isError } = trpc.session.whoAmI.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Ambient probe in the root layout: anonymous visitors resolve `null`,
    // and any residual error must NOT trigger the global session-expired
    // redirect (it runs on public pages too). See createQueryClient in
    // @/lib/trpc/provider.
    meta: { authOptional: true },
  });

  useEffect(() => {
    if (data?.id) {
      Sentry.setUser({ id: data.id });
      Sentry.setTag("user_role", data.role);
      Sentry.setTag("impersonated", data.impersonatorId ? "true" : "false");
    } else if (isError || data === null) {
      // `null` is the resolved answer for an anonymous session (whoAmI no
      // longer throws UNAUTHORIZED for it) — without this branch the
      // stale-identity clear above would be dead code.
      Sentry.setUser(null);
      Sentry.setTag("user_role", undefined);
      Sentry.setTag("impersonated", undefined);
    }
  }, [data, isError]);

  return null;
}
