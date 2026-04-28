"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

type ReasonCode = "CHANGED_PLANS" | "WEATHER" | "FOUND_ALTERNATIVE" | "OTHER";

const REASON_LABELS: Record<ReasonCode, string> = {
  CHANGED_PLANS: "Changed plans",
  WEATHER: "Weather",
  FOUND_ALTERNATIVE: "Found alternative",
  OTHER: "Other",
};

export function BookingCancelDialog({
  bookingId,
  bookingReference,
  open,
  onOpenChange,
}: {
  bookingId: string;
  bookingReference: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState<ReasonCode | "">("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const quote = trpc.booking.quoteCancellation.useQuery(
    { bookingId },
    { enabled: open, staleTime: 30_000 },
  );

  const cancelMutation = trpc.booking.cancel.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => setError(e.message),
  });

  const isNoRefund = quote.data?.refundTier === "NONE";
  const requiresTypedConfirmation = isNoRefund;
  const typedOk = !requiresTypedConfirmation || confirmation.trim().toUpperCase() === "CANCEL";
  const reasonOk = reasonCode !== "" && (reasonCode !== "OTHER" || reasonDetail.trim().length > 0);
  const canSubmit = reasonOk && typedOk && !cancelMutation.isPending && quote.data?.eligible;

  function submit() {
    if (!reasonCode) return;
    setError(null);
    cancelMutation.mutate({
      bookingId,
      reasonCode,
      reasonDetail: reasonDetail.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Cancel booking {bookingReference}</DialogTitle>
          <DialogDescription>
            We&apos;ll refund according to the current cancellation policy and release any bond
            hold on your card.
          </DialogDescription>
        </DialogHeader>

        {quote.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Calculating refund…
          </div>
        )}

        {quote.data && !quote.data.eligible && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            This booking can&apos;t be cancelled from here. Please contact support — reference{" "}
            <code>{bookingReference}</code>.
          </div>
        )}

        {quote.data && quote.data.eligible && (
          <>
            <div className="rounded-md border bg-muted/40 p-4 text-sm">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Paid to date</dt>
                <dd className="font-medium">{formatCurrency(quote.data.amountPaid)}</dd>
                <dt className="text-muted-foreground">Refund tier</dt>
                <dd className="font-medium">
                  {quote.data.refundTier === "FULL"
                    ? "Full (more than 72 hours before pickup)"
                    : quote.data.refundTier === "HALF"
                      ? "50% (24–72 hours before pickup)"
                      : "None (less than 24 hours before pickup)"}
                </dd>
                {quote.data.adminFee > 0 && (
                  <>
                    <dt className="text-muted-foreground">Admin fee</dt>
                    <dd>−{formatCurrency(quote.data.adminFee)}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Refund amount</dt>
                <dd
                  className={
                    quote.data.refundAmount > 0 ? "font-semibold text-primary" : "text-muted-foreground"
                  }
                >
                  {formatCurrency(quote.data.refundAmount)}
                </dd>
                {quote.data.bondReleaseAmount > 0 && (
                  <>
                    <dt className="text-muted-foreground">Bond released</dt>
                    <dd className="font-medium">{formatCurrency(quote.data.bondReleaseAmount)}</dd>
                  </>
                )}
              </dl>
              {quote.data.refundAmount > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Funds will return to your original payment method within 5–10 business days.
                </p>
              )}
            </div>

            {isNoRefund && (
              <div className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">No refund will be issued.</p>
                  <p className="mt-1 text-xs">
                    You&apos;re inside the 24-hour no-refund window. Any bond hold will still be
                    released.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as ReasonCode)}>
                <SelectTrigger id="cancel-reason">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(REASON_LABELS) as ReasonCode[]).map((code) => (
                    <SelectItem key={code} value={code}>
                      {REASON_LABELS[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {reasonCode === "OTHER" && (
              <div className="space-y-2">
                <Label htmlFor="cancel-detail">Tell us more</Label>
                <textarea
                  id="cancel-detail"
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value)}
                  placeholder="A short note helps our team improve."
                  maxLength={500}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}

            {requiresTypedConfirmation && (
              <div className="space-y-2">
                <Label htmlFor="cancel-confirm">
                  Type <strong>CANCEL</strong> to confirm
                </Label>
                <Input
                  id="cancel-confirm"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}
          </>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={cancelMutation.isPending}>
            Keep booking
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
            {cancelMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            Cancel booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
