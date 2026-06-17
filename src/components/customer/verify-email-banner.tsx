"use client";
import { useState } from "react";
import { MailWarning } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

/**
 * R2-M4: shown across the customer portal while the account's email is still
 * unconfirmed, so the customer is nudged to verify before they reach the
 * payment step (where confirmPayment hard-blocks an unverified account).
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const resend = trpc.auth.resendVerification.useMutation();
  const [sent, setSent] = useState(false);

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-destructive/10 px-4 py-3 text-sm text-foreground"
    >
      <MailWarning className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1">
        Confirm your email to book a hire — we sent a link to{" "}
        <strong>{email}</strong>.
      </span>
      {sent ? (
        <span className="text-muted-foreground">Link sent — check your inbox.</span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={resend.isPending}
          onClick={async () => {
            await resend.mutateAsync({ email }).catch(() => undefined);
            setSent(true);
          }}
        >
          {resend.isPending ? "Sending…" : "Resend link"}
        </Button>
      )}
    </div>
  );
}
