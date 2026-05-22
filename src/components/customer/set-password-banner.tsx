"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const DISMISS_KEY = "xpertmoto.setPasswordBanner.dismissedAt";
/** Re-show the banner after this many days even if dismissed. */
const DISMISS_TTL_DAYS = 30;

/**
 * Prompts migrated users (passwordHash=null) to set a password for faster
 * future sign-ins. Rendered only when `show` is true (the server decides
 * this by inspecting the user's passwordHash). Dismissal is persisted in
 * localStorage with a 30-day TTL so it reappears periodically.
 */
export function SetPasswordBanner({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) return;
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (raw) {
      const dismissed = Number(raw);
      if (!Number.isNaN(dismissed)) {
        const ageDays = (Date.now() - dismissed) / (1000 * 60 * 60 * 24);
        if (ageDays < DISMISS_TTL_DAYS) return;
      }
    }
    setVisible(true);
  }, [show]);

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            Set a password for faster sign-in
          </p>
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in without a password. Add one anytime — you can
            still use email sign-in links if you prefer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link href="/dashboard/security">Set password</Link>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
