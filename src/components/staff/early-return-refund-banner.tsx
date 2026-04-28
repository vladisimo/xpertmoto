"use client";

import { useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";

type Props = {
  bookingId: string;
  status: string;
  // Payments eligible to be refunded against (SUCCEEDED, BOOKING_PAYMENT).
  refundablePayments: Array<{ id: string; reference: string; amount: number }>;
};

const ELIGIBLE_STATUSES = ["ACTIVE", "CHECKED_OUT", "CONFIRMED"];

export function EarlyReturnRefundBanner({
  bookingId,
  status,
  refundablePayments,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [paymentId, setPaymentId] = useState<string>(
    refundablePayments[0]?.id ?? "",
  );
  const [customAmount, setCustomAmount] = useState<string>("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const quote = trpc.staffBooking.quoteEarlyReturnRefund.useQuery(
    { bookingId },
    { enabled: ELIGIBLE_STATUSES.includes(status), retry: false },
  );

  const utils = trpc.useUtils();
  const refund = trpc.bookingSettlement.refund.useMutation({
    onSuccess: () => {
      utils.staffBooking.detail.invalidate({ id: bookingId });
      window.location.reload();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Refund failed"),
  });

  if (!ELIGIBLE_STATUSES.includes(status)) return null;
  if (quote.isLoading || !quote.data) return null;
  if (quote.data.refund <= 0) return null;

  const suggested = quote.data.refund;
  const amountAud = customAmount ? Number(customAmount) : suggested;
  const validAmount = !isNaN(amountAud) && amountAud > 0;

  return (
    <div className="rounded-md border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Clock className="h-5 w-5 text-accent shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-semibold">
            Early return — unused days refund available
          </div>
          <p className="text-xs text-muted-foreground">
            {quote.data.unusedDays} unused day
            {quote.data.unusedDays === 1 ? "" : "s"} · daily rate{" "}
            {formatCurrency(quote.data.dailyRate)}
            {quote.data.perDayAddonsTotal > 0 &&
              ` · addons ${formatCurrency(quote.data.perDayAddonsTotal)}/day`}
            {quote.data.perDayInsuranceRate > 0 &&
              ` · insurance ${formatCurrency(quote.data.perDayInsuranceRate)}/day`}
            . Suggested refund:{" "}
            <span className="font-medium">{formatCurrency(suggested)}</span>.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setExpanded((e) => !e);
            setErr(null);
          }}
        >
          {expanded ? "Close" : "Process refund"}
        </Button>
      </div>

      {expanded && (
        <div className="ml-8 rounded-md border border-border bg-background p-3 space-y-3">
          {refundablePayments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No eligible payments to refund against. Record the payment first.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Refund from payment</Label>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={paymentId}
                  onChange={(e) => setPaymentId(e.target.value)}
                >
                  {refundablePayments.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.reference} · {formatCurrency(p.amount)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Amount (AUD, GST-inclusive)
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={customAmount || suggested.toFixed(2)}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Suggested {formatCurrency(suggested)} — adjust if you're
                  splitting the refund.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={`Early return — ${quote.data.unusedDays} unused day${quote.data.unusedDays === 1 ? "" : "s"}`}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!paymentId || !validAmount || refund.isPending}
                  onClick={() => {
                    setErr(null);
                    refund.mutate({
                      paymentId,
                      amount: amountAud,
                      reason:
                        reason.trim() ||
                        `Early return — ${quote.data.unusedDays} unused day${
                          quote.data.unusedDays === 1 ? "" : "s"
                        }`,
                    });
                  }}
                >
                  {refund.isPending && (
                    <Loader2
                      className="mr-1.5 h-3.5 w-3.5 animate-spin"
                      aria-hidden
                    />
                  )}
                  Issue refund
                </Button>
              </div>
            </>
          )}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
      )}
    </div>
  );
}
