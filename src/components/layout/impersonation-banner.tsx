"use client";

import { useState } from "react";
import { AlertTriangle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  displayName: string;
};

/**
 * Persistent red banner shown on every page while an admin is acting on
 * behalf of another user. The session's `impersonatorId` is what drives
 * this — see `src/lib/auth.ts` session callback. The "End impersonation"
 * button calls `/api/impersonate` (POST) which signs the admin out,
 * returning them to /login to re-authenticate with their own credentials.
 */
export function ImpersonationBanner({ displayName }: Props) {
  const [submitting, setSubmitting] = useState(false);

  async function handleEnd() {
    setSubmitting(true);
    try {
      await fetch("/api/impersonate", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/15 px-4 py-2 text-sm text-destructive"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Impersonating <strong>{displayName}</strong>. Every action on this
          screen is attributed to you in the audit log.
        </span>
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={handleEnd}
        disabled={submitting}
      >
        <LogOut className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        End impersonation
      </Button>
    </div>
  );
}
