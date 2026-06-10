"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BookingCancelDialog } from "./booking-cancel-dialog";
import { BookingExtendDialog } from "./booking-extend-dialog";

const CANCELLABLE = new Set(["QUOTE", "PENDING_PAYMENT", "CONFIRMED"]);
const EXTENDABLE = new Set(["CONFIRMED", "CHECKED_OUT", "ACTIVE"]);

export function BookingStickyActions({
  bookingId,
  bookingReference,
  status,
  returnDateTime,
  isExtensionChild,
  hasSubscription,
  supportHref,
}: {
  bookingId: string;
  bookingReference: string;
  status: string;
  returnDateTime: Date;
  isExtensionChild: boolean;
  hasSubscription: boolean;
  supportHref: string;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);

  const canCancel =
    CANCELLABLE.has(status) && !isExtensionChild && !hasSubscription;
  const canExtend = EXTENDABLE.has(status) && !isExtensionChild;

  // H1: surface the refund tier that applies RIGHT NOW next to the cancel
  // button, so the customer knows the consequence before they open the
  // dialog — not after committing to "Cancel booking". Same server quote
  // the dialog uses; tiers are config-driven so we never hardcode them.
  const cancelQuote = trpc.booking.quoteCancellation.useQuery(
    { bookingId },
    { enabled: canCancel && status !== "DISPUTED", staleTime: 60_000 },
  );
  const tierHint = (() => {
    const q = cancelQuote.data;
    if (!q || !q.eligible) return null;
    if (q.refundTier === "FULL")
      return q.adminFee > 0
        ? `Cancelling now: full refund less ${formatCurrency(q.adminFee)} admin fee.`
        : "Cancelling now: full refund.";
    if (q.refundTier === "HALF")
      return "Cancelling now: 50% refund (within 72 hours of pickup).";
    return "Cancelling now: no refund (less than 24 hours before pickup).";
  })();

  if (status === "DISPUTED") {
    return (
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-3 border-b border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive backdrop-blur supports-[backdrop-filter]:bg-destructive/10 sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Payment dispute in progress — changes are paused. Please{" "}
            <Link href={supportHref} className="font-medium underline">
              contact support
            </Link>{" "}
            with reference <code>{bookingReference}</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!canCancel && !canExtend) return null;

  return (
    <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-3 border-b border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
      <div className="flex gap-2 sm:justify-end">
        {canExtend && (
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            onClick={() => setExtendOpen(true)}
          >
            Extend return date
          </Button>
        )}
        {canCancel && (
          <Button
            variant="destructive"
            className="flex-1 sm:flex-none"
            onClick={() => setCancelOpen(true)}
          >
            Cancel booking
          </Button>
        )}
      </div>
      {canCancel && tierHint && (
        <p className="mt-2 text-xs text-muted-foreground sm:text-right">
          {tierHint}
        </p>
      )}
      {!canCancel && (status === "ACTIVE" || status === "CHECKED_OUT") && (
        <p className="mt-2 text-xs text-muted-foreground sm:text-right">
          Your rental is underway, so it can no longer be cancelled — return
          the vehicle to your depot to finish it.
        </p>
      )}

      {canCancel && (
        <BookingCancelDialog
          bookingId={bookingId}
          bookingReference={bookingReference}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
        />
      )}
      {canExtend && (
        <BookingExtendDialog
          bookingId={bookingId}
          bookingReference={bookingReference}
          currentReturnDateTime={returnDateTime}
          open={extendOpen}
          onOpenChange={setExtendOpen}
        />
      )}
    </div>
  );
}
