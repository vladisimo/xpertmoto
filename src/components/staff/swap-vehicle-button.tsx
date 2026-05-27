import Link from "next/link";
import { Replace } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  bookingId: string;
  status: string;
  hasVehicle: boolean;
  /** A DRAFT BookingSwap already exists — the wizard will resume it. */
  hasPendingSwap?: boolean;
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
 */
export function SwapVehicleButton({ bookingId, status, hasVehicle, hasPendingSwap }: Props) {
  if (!hasVehicle) return null;
  if (!(SWAP_ALLOWED_STATUSES as readonly string[]).includes(status)) return null;
  return (
    <Button variant="secondary" size="sm" asChild>
      <Link href={`/staff/bookings/${bookingId}/swap`}>
        <Replace className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {hasPendingSwap ? "Resume vehicle swap" : "Swap vehicle"}
      </Link>
    </Button>
  );
}
