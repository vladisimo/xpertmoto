"use client";

import { createContext, useContext } from "react";
import type { OAuthProviderId } from "@/lib/auth-providers";

/**
 * Feature flags + OAuth provider list for the customer booking wizard,
 * read server-side and propagated down to every step. Using a context
 * avoids prop-drilling through the shell + step components, and centralises
 * the server→client boundary so only `page.tsx` talks to Prisma.
 */
export type BookingFlags = {
  /** Render `<InlineAuthPanel>` in Step 4 instead of redirecting to /login. */
  wizard_inline_auth: boolean;
  /** Render the AU-vs-IDP+passport gate in Step 4 instead of the legacy
   *  licence-OR-passport toggle. */
  wizard_intl_licence_flow: boolean;
  /** Use `BookingShellMobile` at ≤767px viewports. */
  wizard_mobile_shell: boolean;
  /** All canonical OAuth providers (for button rendering order). */
  allOAuthProviders: OAuthProviderId[];
  /** Subset of `allOAuthProviders` that are actually wired in env. */
  enabledOAuthProviders: OAuthProviderId[];
};

const BookingFlagsContext = createContext<BookingFlags | null>(null);

export function BookingFlagsProvider({
  value,
  children,
}: {
  value: BookingFlags;
  children: React.ReactNode;
}) {
  return (
    <BookingFlagsContext.Provider value={value}>
      {children}
    </BookingFlagsContext.Provider>
  );
}

export function useBookingFlags(): BookingFlags {
  const ctx = useContext(BookingFlagsContext);
  if (!ctx) {
    throw new Error(
      "useBookingFlags must be used inside <BookingFlagsProvider> (booking wizard only).",
    );
  }
  return ctx;
}
