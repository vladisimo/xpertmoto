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

export function BookingExtendDialog({
  bookingId,
  bookingReference,
  currentReturnDateTime,
  open,
  onOpenChange,
}: {
  bookingId: string;
  bookingReference: string;
  currentReturnDateTime: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const defaultNewReturn = useMemo(() => {
    const d = new Date(currentReturnDateTime);
    d.setDate(d.getDate() + 1);
    return d;
  }, [currentReturnDateTime]);
  const [newReturnLocal, setNewReturnLocal] = useState(() => toLocalInputValue(defaultNewReturn));
  const [error, setError] = useState<string | null>(null);

  const newReturnDate = useMemo(() => {
    const d = new Date(newReturnLocal);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [newReturnLocal]);

  const canQuote =
    newReturnDate !== null && newReturnDate.getTime() > currentReturnDateTime.getTime();

  const quote = trpc.booking.quoteExtend.useQuery(
    { bookingId, newReturnDateTime: newReturnDate ?? new Date(0) },
    { enabled: open && canQuote, retry: false },
  );

  const extendMutation = trpc.booking.extend.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => setError(e.message),
  });

  function submit() {
    if (!newReturnDate) return;
    setError(null);
    extendMutation.mutate({ bookingId, newReturnDateTime: newReturnDate });
  }

  const quoteErrorMessage = quote.error?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Extend booking {bookingReference}</DialogTitle>
          <DialogDescription>
            Pick a new return date and we&apos;ll price the extra days at current rates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current return</span>
            <span className="font-medium">{formatDateTime(currentReturnDateTime)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="extend-return">New return date &amp; time</Label>
          <Input
            id="extend-return"
            type="datetime-local"
            value={newReturnLocal}
            min={toLocalInputValue(currentReturnDateTime)}
            onChange={(e) => setNewReturnLocal(e.target.value)}
          />
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

        {quote.data && !quote.isFetching && (
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Additional days</dt>
              <dd className="font-medium">{quote.data.quote.extensionDays}</dd>
              <dt className="text-muted-foreground">Extension charge</dt>
              <dd className="font-semibold text-primary">
                {formatCurrency(quote.data.quote.totalAmount)}
              </dd>
              <dt className="text-muted-foreground">New total</dt>
              <dd className="font-medium">{formatCurrency(quote.data.newTotal)}</dd>
              <dt className="text-muted-foreground">New balance due</dt>
              <dd className="font-medium">{formatCurrency(quote.data.newBalanceDue)}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              GST inclusive. The charge will be captured from your card on file.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={extendMutation.isPending}>
            Close
          </Button>
          <Button
            onClick={submit}
            disabled={
              !canQuote ||
              !quote.data ||
              quote.isFetching ||
              extendMutation.isPending ||
              Boolean(quoteErrorMessage)
            }
          >
            {extendMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            )}
            Confirm extension
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
