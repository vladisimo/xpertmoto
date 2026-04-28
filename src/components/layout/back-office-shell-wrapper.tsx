"use client";

import { SessionProvider } from "next-auth/react";
import { BackOfficeShell, type ShellAccent } from "@/components/layout/back-office-shell";

export function BackOfficeShellWrapper({
  children,
  user,
  signOutAction,
  accent = "staff",
  notificationsPaused = false,
}: {
  children: React.ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    avatarUrl?: string | null;
  };
  signOutAction: () => Promise<void>;
  accent?: ShellAccent;
  notificationsPaused?: boolean;
}) {
  return (
    <SessionProvider>
      <BackOfficeShell
        user={user}
        signOutAction={signOutAction}
        accent={accent}
        notificationsPaused={notificationsPaused}
      >
        {children}
      </BackOfficeShell>
    </SessionProvider>
  );
}
