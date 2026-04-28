"use client";

import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

export function InvoiceResendButton({ invoiceId }: { invoiceId: string }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const resend = trpc.staffBooking.resendInvoice.useMutation({
    onSuccess: () => {
      setState("sent");
      setMessage(null);
      setTimeout(() => setState("idle"), 3000);
    },
    onError: (e) => {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Send failed");
      setTimeout(() => {
        setState("idle");
        setMessage(null);
      }, 5000);
    },
  });
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={resend.isPending}
        onClick={() => resend.mutate({ invoiceId })}
      >
        {resend.isPending ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <MailCheck className="mr-1 h-3 w-3" aria-hidden />
        )}
        {state === "sent" ? "Sent" : "Resend"}
      </Button>
      {state === "error" && message && (
        <span className="text-xs text-destructive">{message}</span>
      )}
    </div>
  );
}
