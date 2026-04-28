"use client";

import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/shared/brand-logo";

interface StepUpFormProps {
  nextPath: string | null;
  userRole: UserRole;
  userEmail: string | null;
}

function defaultDestinationFor(role: UserRole): string {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return "/admin/dashboard";
  if (role === "STAFF" || role === "MANAGER") return "/staff/dashboard";
  return "/dashboard";
}

export function StepUpForm({
  nextPath,
  userRole,
  userEmail,
}: StepUpFormProps) {
  const { update } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const verify = trpc.auth.verifyOauthStepUp.useMutation();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await verify.mutateAsync({ code: code.trim() });
      // The mutation hands us a short-lived HMAC-signed handoff token.
      // The jwt callback rejects any `update(...)` payload that doesn't
      // include a valid one, so an attacker calling `update()` from
      // devtools cannot bypass the TOTP gate.
      await update({ stepUpToken: result.stepUpToken });
      const destination = nextPath ?? defaultDestinationFor(userRole);
      window.location.href = destination;
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Invalid 2FA code";
      setError(message);
      setSubmitting(false);
    }
  }

  async function onCancel() {
    // The user got stuck — sign them out so they land on /login with a
    // clean slate. Without this, refreshing leaves them in pending2fa
    // forever.
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="space-y-8">
      <div className="md:hidden">
        <BrandLogo variant="mark" height={44} />
      </div>

      <div className="space-y-2">
        <h1 className="h-display">Two-factor authentication</h1>
        <p className="body-text text-muted-foreground">
          {userEmail ? (
            <>
              Signed in as <span className="font-medium">{userEmail}</span>.
              Enter the 6-digit code from your authenticator app, or one of
              your recovery codes.
            </>
          ) : (
            <>
              Enter the 6-digit code from your authenticator app, or one of
              your recovery codes.
            </>
          )}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="caption">{error}</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="totpCode" className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Authenticator code
          </Label>
          <Input
            id="totpCode"
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, 24))}
            placeholder="123456 or xxxxx-xxxxx"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            disabled={submitting}
          />
          <p className="caption text-muted-foreground">
            Lost your device? Use one of the recovery codes you saved when
            setting up 2FA.
          </p>
        </div>

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={submitting || code.trim().length === 0}
        >
          {submitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          )}
          {submitting ? "Verifying code…" : "Verify and continue"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel and sign out
        </Button>
      </form>
    </div>
  );
}
