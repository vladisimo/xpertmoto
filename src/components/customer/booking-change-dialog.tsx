"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDateTime } from "@/lib/utils";

function toLocalInputValue(d: Date): string {
  // `<input type="datetime-local">` expects a naive local ISO string.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * M-5: customer self-service date/time change. Lets a customer move the
 * pickup and/or return of a CONFIRMED booking; the preview reprices and shows
 * the delta (extra charge, reduction, or retained credit) before Confirm.
 */
export function BookingChangeDialog({
  bookingId,
  bookingReference,
  currentPickupDateTime,
  currentReturnDateTime,
  open,
  onOpenChange,
}: {
  bookingId: string;
  bookingReference: string;
  currentPickupDateTime: Date;
  currentReturnDateTime: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pickupLocal, setPickupLocal] = useState(() =>
    toLocalInputValue(currentPickupDateTime),
  );
  const [returnLocal, setReturnLocal] = useState(() =>
    toLocalInputValue(currentReturnDateTime),
  );
  const [error, setError] = useState<string | null>(null);

  const newPickup = useMemo(() => {
    const d = new Date(pickupLocal);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [pickupLocal]);
  const newReturn = useMemo(() => {
    const d = new Date(returnLocal);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [returnLocal]);

  const changed =
    newPickup !== null &&
    newReturn !== null &&
    (newPickup.getTime() !== currentPickupDateTime.getTime() ||
      newReturn.getTime() !== currentReturnDateTime.getTime());
  const validWindow =
    newPickup !== null && newReturn !== null && newReturn.getTime() > newPickup.getTime();
  const canQuote = changed && validWindow;

  const quote = trpc.booking.quoteChange.useQuery(
    {
      bookingId,
      newPickupDateTime: newPickup ?? new Date(0),
      newReturnDateTime: newReturn ?? new Date(0),
    },
    { enabled: open && canQuote, retry: false },
  );

  const changeMutation = trpc.booking.change.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => setError(e.message),
  });

  function submit() {
    if (!newPickup || !newReturn) return;
    setError(null);
    changeMutation.mutate({
      bookingId,
      newPickupDateTime: newPickup,
      newReturnDateTime: newReturn,
    });
  }

  const quoteErrorMessage = quote.error?.message;
  const preview = quote.data;

  const deltaLabel =
    preview?.direction === "INCREASE"
      ? "Additional charge"
      : preview?.direction === "DECREASE"
        ? "Reduction"
        : "Price change";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Change dates — {bookingReference}</DialogTitle>
          <DialogDescription>
            Move your pickup and/or return. We&apos;ll reprice at current rates
            and show any difference before you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="change-pickup">New pickup</Label>
            <Input
              id="change-pickup"
              type="datetime-local"
              value={pickupLocal}
              onChange={(e) => setPickupLocal(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-return">New return</Label>
            <Input
              id="change-return"
              type="datetime-local"
              value={returnLocal}
              min={pickupLocal}
              onChange={(e) => setReturnLocal(e.target.value)}
            />
          </div>
        </div>

        {quote.isFetching && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Calculating…
          </div>
        )}

        {quoteErrorMessage && !quote.isFetching && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {quoteErrorMessage}
          </div>
        )}

        {preview && !quote.isFetching && (
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">New window</dt>
              <dd className="text-right font-medium">
                {formatDateTime(preview.newPickupDateTime)} →{" "}
                {formatDateTime(preview.newReturnDateTime)}
              </dd>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-medium">{preview.newDurationDays} day(s)</dd>
              <dt className="text-muted-foreground">{deltaLabel}</dt>
              <dd className="font-semibold text-primary">
                {preview.direction === "NONE"
                  ? "No change"
                  : formatCurrency(Math.abs(preview.delta))}
              </dd>
              <dt className="text-muted-foreground">New total</dt>
              <dd className="font-medium">{formatCurrency(preview.newTotal)}</dd>
              <dt className="text-muted-foreground">New balance due</dt>
              <dd className="font-medium">{formatCurrency(preview.newBalanceDue)}</dd>
              {preview.creditAmount > 0 && (
                <>
                  <dt className="text-muted-foreground">Account credit held</dt>
                  <dd className="font-medium">{formatCurrency(preview.creditAmount)}</dd>
                </>
              )}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {preview.direction === "INCREASE"
                ? "GST inclusive. The extra charge will be captured from your card on file."
                : preview.direction === "DECREASE"
                  ? "GST inclusive. Any amount you've overpaid is held as account credit — we won't auto-refund your card."
                  : "GST inclusive. No payment is needed for this change."}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={changeMutation.isPending}
          >
            Close
          </Button>
          <Button
            onClick={submit}
            disabled={
              !canQuote ||
              !preview ||
              quote.isFetching ||
              changeMutation.isPending ||
              Boolean(quoteErrorMessage)
            }
          >
            {changeMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            Confirm change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
