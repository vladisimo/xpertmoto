import Link from "next/link";
import { Replace } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  bookingId: string;
  status: string;
  hasVehicle: boolean;
};

const SWAP_ALLOWED_STATUSES = ["ACTIVE", "CHECKED_OUT", "OVERDUE"] as const;

/**
 * Entry point into the mid-rental swap wizard. Visible only while the
 * booking is in a state that can be swapped — the wizard itself re-checks
 * the guard server-side, so even a lucky URL click bounces cleanly.
 */
export function SwapVehicleButton({ bookingId, status, hasVehicle }: Props) {
  if (!hasVehicle) return null;
  if (!(SWAP_ALLOWED_STATUSES as readonly string[]).includes(status)) return null;
  return (
    <Button variant="secondary" size="sm" asChild>
      <Link href={`/staff/bookings/${bookingId}/swap`}>
        <Replace className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        Swap vehicle
      </Link>
    </Button>
  );
}
