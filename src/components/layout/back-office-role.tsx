"use client";

/**
 * The signed-in back-office user's role, published by <BackOfficeShell> around
 * the page content. Nav chrome nested inside a page (the section top bar and
 * its strip) can then gate itself on role without every route-group layout
 * threading the role down as a prop.
 *
 * `undefined` outside the shell — role-gated nav entries stay hidden in that
 * case, which is the safe default for chrome whose destinations are gated
 * server-side anyway.
 */

import * as React from "react";
import type { UserRole } from "@/lib/nav";

const BackOfficeRoleContext = React.createContext<UserRole | undefined>(undefined);

export function BackOfficeRoleProvider({
  role,
  children,
}: {
  role: UserRole | undefined;
  children: React.ReactNode;
}) {
  return (
    <BackOfficeRoleContext.Provider value={role}>{children}</BackOfficeRoleContext.Provider>
  );
}

export function useBackOfficeRole(): UserRole | undefined {
  return React.useContext(BackOfficeRoleContext);
}
