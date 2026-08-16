"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Replace } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  bookingId: string;
  status: string;
  hasVehicle: boolean;
  /** A DRAFT BookingSwap already exists — the wizard will resume it. */
  hasPendingSwap?: boolean;
  /**
   * The assigned vehicle is lost to the fleet (STOLEN / WRITTEN_OFF /
   * END_OF_LIFE status, or an open TOTAL_LOSS incident on it). Switches the
   * entry point to the loss-replacement flow, which waives the outgoing
   * inspection.
   */
  vehicleLost?: boolean;
  /** Manager+ — `startLossReplacementDraft` is manager-gated server-side. */
  canManage?: boolean;
  /** Open TOTAL_LOSS incident on the lost vehicle, linked onto the draft. */
  lossIncidentId?: string;
};

const SWAP_ALLOWED_STATUSES = ["ACTIVE", "CHECKED_OUT", "OVERDUE"] as const;

/**
 * Entry point into the mid-rental swap wizard. Visible only while the
 * booking is in a state that can be swapped — the wizard itself re-checks
 * the guard server-side, so even a lucky URL click bounces cleanly.
 *
 * When a DRAFT swap is already in progress the label flips to "Resume
 * vehicle swap" so staff know they're re-entering an existing draft rather
 * than starting fresh.
 *
 * When the assigned vehicle is lost (Area 2), managers instead get
 * "Arrange replacement (vehicle lost)" which opens a LOSS_REPLACEMENT
 * draft via `bookingSwap.startLossReplacementDraft` and drops into the
 * wizard with the outgoing inspection waived.
 */
export function SwapVehicleButton({
  bookingId,
  status,
  hasVehicle,
  hasPendingSwap,
  vehicleLost,
  canManage,
  lossIncidentId,
}: Props) {
  if (!hasVehicle) return null;
  if (!(SWAP_ALLOWED_STATUSES as readonly string[]).includes(status)) return null;
  if (vehicleLost && !hasPendingSwap && canManage) {
    return <LossReplacementButton bookingId={bookingId} incidentId={lossIncidentId} />;
  }
  return (
    <Button variant="secondary" size="sm" asChild>
      <Link href={`/staff/bookings/${bookingId}/swap`}>
        <Replace className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {hasPendingSwap ? "Resume vehicle swap" : "Swap vehicle"}
      </Link>
    </Button>
  );
}

/**
 * Loss-replacement entry: prompts for the mandatory reason note, opens the
 * LOSS_REPLACEMENT draft (manager-gated + loss-verified server-side), then
 * routes into the swap wizard, which resumes the draft and skips the
 * outgoing inspection.
 */
function LossReplacementButton({
  bookingId,
  incidentId,
}: {
  bookingId: string;
  incidentId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reasonNotes, setReasonNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = trpc.bookingSwap.startLossReplacementDraft.useMutation({
    onSuccess: () => {
      router.push(`/staff/bookings/${bookingId}/swap`);
    },
    onError: (e) => setError(e.message),
  });

  const submit = () => {
    if (!reasonNotes.trim()) return;
    setError(null);
    start.mutate({
      bookingId,
      reasonNotes: reasonNotes.trim(),
      incidentId,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Replace className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Arrange replacement (vehicle lost)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Arrange replacement — vehicle lost</DialogTitle>
          <DialogDescription>
            Opens a loss-replacement swap: no price change for the customer, the
            outgoing inspection is waived, and the lost vehicle keeps its
            disposition status. You&apos;ll pick the replacement and record its
            pre-hire condition in the swap wizard.
            {incidentId ? " The open total-loss incident will be linked." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="loss-swap-reason">Reason note (required)</Label>
          <Input
            id="loss-swap-reason"
            value={reasonNotes}
            onChange={(e) => setReasonNotes(e.target.value)}
            placeholder="e.g. Vehicle stolen overnight — police event QP1234567"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={start.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={start.isPending || !reasonNotes.trim()}>
            {start.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Start replacement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
