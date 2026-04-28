"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDateTime } from "@/lib/utils";

/**
 * Phase B — unified Booking Payment Console.
 *
 * Replaces the read-only Payments tab + the RecordPaymentInline
 * dropdown + the check-in/settle page with one interactive view. Every
 * action goes through the bookingSettlement router so the audit trail
 * is consistent.
 */

type Payment = {
  id: string;
  reference: string;
  type: string;
  method: string;
  amount: string | number;
  status: StatusKey;
  notes: string | null;
  stripeChargeId: string | null;
  createdAt: string | Date;
};

type BondLedger = {
  heldAmount: string | number;
  capturedAmount: string | number;
  releasedAmount: string | number;
  status: StatusKey;
  deductions: unknown;
} | null;

type BillingPlan = {
  id: string;
  frequency: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY";
  amountPerPeriod: string | number;
  periodsTotal: number;
  periodsCompleted: number;
  nextChargeAt: string | Date;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  pauseReason: string | null;
} | null;

type Props = {
  bookingId: string;
  bookingStatus: string;
  balanceDue: number;
  payments: Payment[];
  bondLedger: BondLedger;
  billingPlan: BillingPlan;
};

const TERMINAL_BOOKING_STATUSES = ["CANCELLED", "COMPLETED", "NO_SHOW"];

const MANUAL_TYPES = [
  { value: "MANUAL_CHARGE", label: "Manual charge" },
  { value: "CLEANING_FEE", label: "Cleaning fee" },
  { value: "FUEL_CHARGE", label: "Fuel charge" },
  { value: "LATE_FEE", label: "Late fee" },
  { value: "DAMAGE_CHARGE", label: "Damage charge" },
  { value: "ADDON_CHARGE", label: "Add-on" },
] as const;

export function PaymentConsole({
  bookingId,
  bookingStatus,
  balanceDue,
  payments,
  bondLedger,
  billingPlan,
}: Props) {
  const isBookingTerminal = TERMINAL_BOOKING_STATUSES.includes(bookingStatus);
  const isPlanTerminal =
    billingPlan?.status === "CANCELLED" || billingPlan?.status === "COMPLETED";
  const utils = trpc.useUtils();
  const refresh = () => {
    utils.staffBooking.detail.invalidate({ id: bookingId });
    window.location.reload();
  };
  const onErr = (e: unknown) =>
    setErr(e instanceof Error ? e.message : "Action failed");
  const [err, setErr] = useState<string | null>(null);

  const addCharge = trpc.bookingSettlement.addManualCharge.useMutation({ onSuccess: refresh, onError: onErr });
  const voidPayment = trpc.bookingSettlement.voidPayment.useMutation({ onSuccess: refresh, onError: onErr });
  const captureNow = trpc.bookingSettlement.captureNow.useMutation({ onSuccess: refresh, onError: onErr });
  const refund = trpc.bookingSettlement.refund.useMutation({ onSuccess: refresh, onError: onErr });
  const releaseBond = trpc.bookingSettlement.releaseBond.useMutation({ onSuccess: refresh, onError: onErr });
  const captureBond = trpc.bookingSettlement.captureBond.useMutation({ onSuccess: refresh, onError: onErr });
  const pausePlan = trpc.bookingSettlement.pauseBillingPlan.useMutation({ onSuccess: refresh, onError: onErr });
  const resumePlan = trpc.bookingSettlement.resumeBillingPlan.useMutation({ onSuccess: refresh, onError: onErr });
  const cancelPlan = trpc.bookingSettlement.cancelBillingPlan.useMutation({ onSuccess: refresh, onError: onErr });

  const [addOpen, setAddOpen] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [addType, setAddType] = useState<(typeof MANUAL_TYPES)[number]["value"]>("MANUAL_CHARGE");
  const [addGst, setAddGst] = useState(true);

  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseAmount, setReleaseAmount] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureAmount, setCaptureAmount] = useState("");
  const [captureLabel, setCaptureLabel] = useState("");

  const [refundOpen, setRefundOpen] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  // Date.now() during render is flagged impure by react-hooks/purity.
  // Lazy initializer runs once per mount and satisfies the rule while
  // keeping the age badges stable across re-renders.
  const [nowMs] = useState<number | null>(() =>
    typeof window === "undefined" ? null : Date.now(),
  );

  const bondHeld = bondLedger ? Number(bondLedger.heldAmount) : 0;
  const bondCaptured = bondLedger ? Number(bondLedger.capturedAmount) : 0;
  const bondReleased = bondLedger ? Number(bondLedger.releasedAmount) : 0;
  const bondRemaining = Math.max(0, bondHeld - bondCaptured - bondReleased);

  const bondDeductions = Array.isArray(bondLedger?.deductions)
    ? (bondLedger!.deductions as Array<{ reason?: string; amount?: number }>)
    : [];

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {/* Summary row */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Balance due</div>
          <div className="h2 tabular-nums">{formatCurrency(balanceDue)}</div>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Bond held</div>
          <div className="h2 tabular-nums">{formatCurrency(bondHeld)}</div>
          {bondLedger && (
            <div className="caption mt-1">
              Captured {formatCurrency(bondCaptured)} · Released {formatCurrency(bondReleased)}
            </div>
          )}
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="caption">Next recurring charge</div>
          <div className="h3 tabular-nums">
            {!billingPlan || isPlanTerminal
              ? "—"
              : formatDateTime(billingPlan.nextChargeAt)}
          </div>
          {billingPlan && (
            <div className="caption mt-1">
              {isPlanTerminal
                ? `Plan ${billingPlan.status.toLowerCase()}`
                : `${formatCurrency(Number(billingPlan.amountPerPeriod))} · ${billingPlan.frequency.toLowerCase()}`}
            </div>
          )}
        </div>
      </div>

      {/* Charges ledger */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="h3">Charges</CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            + Add charge
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {payments.length === 0 && <p className="text-muted-foreground">No charges yet.</p>}
          {payments.map((p) => {
            const amountNum = Number(p.amount);
            const ageDays =
              nowMs === null
                ? 0
                : (nowMs - new Date(p.createdAt).getTime()) / 86_400_000;
            const over180d = ageDays > 180;
            const asyncRefundFailure =
              p.status === "FAILED" &&
              p.type === "REFUND" &&
              (p.notes?.toLowerCase().includes("async refund failure") ?? false);
            return (
              <div key={p.id} className="flex items-center justify-between border-b py-2 last:border-0">
                <div>
                  <div className="font-medium">
                    {p.type.replace(/_/g, " ")} · {p.method}
                  </div>
                  {p.notes && <div className="caption">{p.notes}</div>}
                  <div className="caption">Ref: {p.reference}</div>
                  {asyncRefundFailure && (
                    <div className="caption text-destructive mt-1">
                      ⚠️ Stripe reported this refund failed asynchronously after initial success.
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-right">
                  <span className="tabular-nums">{formatCurrency(amountNum)}</span>
                  <StatusBadge status={p.status} />
                  {asyncRefundFailure && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        // Staff retries by issuing a fresh refund against
                        // the original source Payment. The Payment Console
                        // already has the Refund action — jump the user
                        // back there by opening a hint alert.
                        alert(
                          "To retry, find the original successful charge row above and click Refund. If the charge is >180 days old, issue a Credit Note instead.",
                        );
                      }}
                    >
                      Retry refund
                    </Button>
                  )}
                  {p.status === "PENDING" && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={captureNow.isPending}
                        onClick={() => captureNow.mutate({ paymentId: p.id })}
                      >
                        Capture
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const reason = window.prompt("Reason for voiding?") ?? "";
                          if (reason.trim()) voidPayment.mutate({ paymentId: p.id, reason });
                        }}
                      >
                        Void
                      </Button>
                    </>
                  )}
                  {p.status === "SUCCEEDED" && p.type !== "BOND_RELEASE" && p.type !== "REFUND" && (
                    over180d ? (
                      <span className="text-xs text-muted-foreground" title="Stripe rejects refunds on charges older than 180 days. Issue a Credit Note instead.">
                        Refund · too old ({Math.floor(ageDays)}d) — use Credit Note
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRefundOpen(p.id);
                          setRefundAmount(amountNum.toFixed(2));
                          setRefundReason("");
                        }}
                      >
                        Refund
                      </Button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Add-charge modal (inline panel to match existing styling). */}
      {addOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Add a charge</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Type</Label>
              <Select value={addType} onValueChange={(v) => setAddType(v as typeof addType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MANUAL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (A$)</Label>
              <Input
                type="number"
                step="0.01"
                min={0.01}
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Input
                value={addDesc}
                onChange={(e) => setAddDesc(e.target.value)}
                placeholder="e.g. End-of-hire deep clean"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addGst}
                onChange={(e) => setAddGst(e.target.checked)}
              />
              GST-inclusive (10%)
            </label>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={addCharge.isPending || !addAmount || !addDesc.trim()}
                onClick={() =>
                  addCharge.mutate({
                    bookingId,
                    amount: Number(addAmount),
                    description: addDesc.trim(),
                    type: addType,
                    gstInclusive: addGst,
                  })
                }
              >
                {addCharge.isPending ? "Adding…" : "Add charge"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refund modal */}
      {refundOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Refund payment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Amount (A$)</Label>
              <Input
                type="number"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="required"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRefundOpen(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={refund.isPending || !refundReason.trim() || !refundAmount}
                onClick={() =>
                  refund.mutate({
                    paymentId: refundOpen,
                    amount: Number(refundAmount),
                    reason: refundReason.trim(),
                  })
                }
              >
                {refund.isPending ? "Refunding…" : "Issue refund"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bond + Billing plan sit side-by-side at xl: so the tab feels denser
          on wide screens. Either may be absent — the grid still flows. */}
      <div className="grid gap-6 xl:grid-cols-2">
      {/* Bond controls */}
      {bondLedger && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Bond</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-4">
              <Row label="Held" value={formatCurrency(bondHeld)} />
              <Row label="Captured" value={formatCurrency(bondCaptured)} />
              <Row label="Released" value={formatCurrency(bondReleased)} />
              <Row label="Remaining" value={formatCurrency(bondRemaining)} />
            </div>
            {bondDeductions.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="caption mb-1">Deductions</div>
                {bondDeductions.map((d, i) => (
                  <div key={i} className="flex justify-between py-0.5">
                    <span>{d.reason ?? "—"}</span>
                    <span>{formatCurrency(Number(d.amount ?? 0))}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReleaseOpen(true)}
                disabled={bondRemaining <= 0 || isBookingTerminal}
              >
                Release bond
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setCaptureOpen(true)}
                disabled={bondRemaining <= 0 || isBookingTerminal}
              >
                Capture from bond
              </Button>
            </div>

            {releaseOpen && (
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Amount (blank = all)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={releaseAmount}
                    onChange={(e) => setReleaseAmount(e.target.value)}
                    placeholder={bondRemaining.toFixed(2)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Reason</Label>
                  <Input
                    value={releaseReason}
                    onChange={(e) => setReleaseReason(e.target.value)}
                    placeholder="required"
                  />
                </div>
                <div className="sm:col-span-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setReleaseOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={releaseBond.isPending || !releaseReason.trim()}
                    onClick={() =>
                      releaseBond.mutate({
                        bookingId,
                        amount: releaseAmount ? Number(releaseAmount) : undefined,
                        reason: releaseReason.trim(),
                      })
                    }
                  >
                    {releaseBond.isPending ? "Releasing…" : "Release"}
                  </Button>
                </div>
              </div>
            )}

            {captureOpen && (
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={captureAmount}
                    onChange={(e) => setCaptureAmount(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Label (e.g. &quot;Damage to front fairing&quot;)</Label>
                  <Input
                    value={captureLabel}
                    onChange={(e) => setCaptureLabel(e.target.value)}
                    placeholder="required"
                  />
                </div>
                <div className="sm:col-span-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setCaptureOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={captureBond.isPending || !captureAmount || !captureLabel.trim()}
                    onClick={() =>
                      captureBond.mutate({
                        bookingId,
                        amount: Number(captureAmount),
                        deductionLabel: captureLabel.trim(),
                      })
                    }
                  >
                    {captureBond.isPending ? "Capturing…" : "Capture"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Billing plan controls */}
      {billingPlan && (
        <Card>
          <CardHeader>
            <CardTitle className="h3">Billing plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <Row label="Frequency" value={billingPlan.frequency} />
              <Row label="Amount / period" value={formatCurrency(Number(billingPlan.amountPerPeriod))} />
              <Row
                label="Periods"
                value={`${billingPlan.periodsCompleted} / ${billingPlan.periodsTotal}`}
              />
              <Row label="Next charge" value={formatDateTime(billingPlan.nextChargeAt)} />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={billingPlan.status as StatusKey} />
              </div>
              {billingPlan.pauseReason && (
                <Row label="Pause reason" value={billingPlan.pauseReason} />
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {!isBookingTerminal && billingPlan.status === "ACTIVE" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt("Pause reason?") ?? "";
                    if (reason.trim()) pausePlan.mutate({ bookingId, reason });
                  }}
                >
                  Pause
                </Button>
              )}
              {!isBookingTerminal && billingPlan.status === "PAUSED" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => resumePlan.mutate({ bookingId })}
                >
                  Resume
                </Button>
              )}
              {!isBookingTerminal && !isPlanTerminal && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    const reason = window.prompt("Cancel plan — reason?") ?? "";
                    if (reason.trim()) cancelPlan.mutate({ bookingId, reason });
                  }}
                >
                  Cancel plan
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
