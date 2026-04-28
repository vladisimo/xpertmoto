"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, MailCheck, Loader2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

type Props = {
  bookingId: string;
  status: string;
  currentVehicleLabel?: string | null;
};

const EXTEND_ALLOWED = ["CONFIRMED", "CHECKED_OUT", "ACTIVE"];
// Mirrors CANCELLABLE_STATUSES in src/server/services/booking-cancellation.ts.
// Once the customer has collected the vehicle (CHECKED_OUT/ACTIVE/OVERDUE/
// RETURNED), staff close the booking through Check-in / Return rather than
// cancelling.
const CANCEL_ALLOWED = ["QUOTE", "PENDING_PAYMENT", "CONFIRMED"];
const RESEND_CONFIRMATION_ALLOWED = [
  "CONFIRMED",
  "CHECKED_OUT",
  "ACTIVE",
  "OVERDUE",
  "RETURNED",
  "COMPLETED",
];

export function BookingHeaderActions({
  bookingId,
  status,
  currentVehicleLabel: _currentVehicleLabel,
}: Props) {
  const router = useRouter();
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendOk, setResendOk] = useState(false);

  const resend = trpc.staffBooking.resendConfirmation.useMutation({
    onSuccess: () => {
      setResendOk(true);
      setResendError(null);
      setTimeout(() => setResendOk(false), 3000);
    },
    onError: (e) => {
      setResendError(e instanceof Error ? e.message : "Send failed");
      setTimeout(() => setResendError(null), 5000);
    },
  });

  const canExtend = EXTEND_ALLOWED.includes(status);
  const canCancel = CANCEL_ALLOWED.includes(status);
  const canResend = RESEND_CONFIRMATION_ALLOWED.includes(status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canExtend && (
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/staff/bookings/${bookingId}/extend`}>
            <CalendarPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Extend
          </Link>
        </Button>
      )}
      {canResend && (
        <Button
          variant="secondary"
          size="sm"
          disabled={resend.isPending}
          onClick={() => {
            setResendError(null);
            setResendOk(false);
            resend.mutate({ bookingId });
          }}
        >
          {resend.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <MailCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {resendOk ? "Sent" : "Resend confirmation"}
        </Button>
      )}
      {canCancel && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => router.push(`/staff/bookings/${bookingId}/cancel`)}
        >
          <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Cancel booking
        </Button>
      )}
      {resendError && (
        <span className="text-xs text-destructive">{resendError}</span>
      )}
    </div>
  );
}
