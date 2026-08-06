"use client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { useState } from "react";
import { trpc } from "./client";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

function httpStatusOf(error: unknown): number | undefined {
  return (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
}

// Bounce to login/onboarding at most once per page life — a batch of queries
// can all 401 at the same instant; we only want one navigation.
let redirecting = false;
function redirectOnce(to: string) {
  if (redirecting) return;
  redirecting = true;
  window.location.assign(to);
}

// Global auth-error handler. An expired/cleared session makes every protected
// tRPC call fail; without this the dashboard spins on "Loading…" forever and
// checkout surfaces unrelated errors (H-2/L-14). We treat 401 as "session
// expired → re-authenticate" and 403 + "onboarding" as "finish onboarding",
// preserving the current path so the user resumes where they left off. Genuine
// permission 403s (no onboarding hint) fall through to the calling component.
function handleAuthError(error: unknown) {
  if (typeof window === "undefined") return;
  const status = httpStatusOf(error);
  if (status !== 401 && status !== 403) return;
  const here = window.location.pathname + window.location.search;

  if (status === 403) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("onboarding")) return; // real permission denial
    if (window.location.pathname.startsWith("/onboarding")) return;
    redirectOnce(`/onboarding?next=${encodeURIComponent(here)}`);
    return;
  }

  // 401 — absent / expired session.
  if (window.location.pathname.startsWith("/login")) return;
  redirectOnce(`/login?reason=expired&callbackUrl=${encodeURIComponent(here)}`);
}

function createQueryClient() {
  return new QueryClient({
    // Ambient probes (e.g. the SentryIdentify/PostHogIdentify `whoAmI` in
    // the root layout) run on PUBLIC pages for anonymous visitors — those
    // must NOT bounce a logged-out browser to /login, so they opt out with
    // `meta: { authOptional: true }`. (whoAmI now resolves `null` instead of
    // 401ing for anonymous sessions, but the opt-out stays: customer.me
    // still 401s, and any error on an ambient probe means "anonymous", not
    // "expired".) Mutations are deliberate user actions, so a 401 there
    // always means "your session expired".
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.authOptional) return;
        handleAuthError(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.authOptional) return;
        handleAuthError(error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // true (the default = refetch only stale queries), NOT "always":
        // a reconnect (wifi blip, laptop wake) with "always" refetched
        // every mounted query at once — 50–100 simultaneous calls from a
        // busy back-office tab. Fresh queries (< staleTime) ride it out.
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          const status = httpStatusOf(error);
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
        placeholderData: (prev: unknown) => prev,
      },
      mutations: { retry: 0 },
    },
  });
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
