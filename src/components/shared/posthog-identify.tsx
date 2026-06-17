"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc/client";

/**
 * Associates the anonymous PostHog browser distinct_id with the signed-in
 * user so client-side events + session replay stitch onto the same person
 * the server identifies via `trackServerIdentify` (which also keys on
 * `User.id`).
 *
 * Identity comes from `session.whoAmI` — the lightweight query built for
 * client components that can't rely on a NextAuth `<SessionProvider>` — so
 * this works from the root layout without forcing every page to render
 * dynamically. Anonymous visitors get an UNAUTHORIZED error (no retry, no
 * identify), which is the desired no-op.
 *
 * Email/name are already set on the person profile server-side at signup, so
 * we deliberately do NOT re-send PII from the browser — only the stable id
 * plus role. `window.posthog` is the inline-snippet stub, which queues the
 * call until array.js finishes loading, so firing in an effect is safe.
 */
export function PostHogIdentify() {
  const { data } = trpc.session.whoAmI.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Ambient probe in the root layout: a 401 here just means "anonymous"
    // and must NOT trigger the global session-expired redirect (it runs on
    // public pages too). See createQueryClient in @/lib/trpc/provider.
    meta: { authOptional: true },
  });
  useEffect(() => {
    if (!data?.id) return;
    window.posthog?.identify(data.id, { role: data.role });
  }, [data?.id, data?.role]);
  return null;
}
