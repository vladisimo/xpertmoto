"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type Props = {
  bookingId: string;
  status: string;
  hasVehicle: boolean;
  pickupDateTime: string;
  returnDateTime: string;
  balanceDue: number;
  hasSignedReturnAssessment?: boolean;
};

type PromptKind =
  | "confirmQuote"
  | "recordPayment"
  | "markNoShow"
  | "markOverdue"
  | "markReturned"
  | "markDisputed"
  | "resolveDispute"
  | "completeFromReturned"
  | "closeOut";

export function StatusActions({
  bookingId,
  status,
  pickupDateTime,
  returnDateTime: _returnDateTime,
  balanceDue,
  hasSignedReturnAssessment = false,
}: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState<PromptKind | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [pickupPassed, setPickupPassed] = useState(false);
  useEffect(() => {
    setPickupPassed(new Date(pickupDateTime).getTime() < Date.now());
  }, [pickupDateTime]);

  const refresh = () => {
    setPrompt(null);
    setErr(null);
    router.refresh();
  };
  const onError = (e: unknown) => setErr(e instanceof Error ? e.message : "Action failed");

  const confirmQuote = trpc.staffBooking.confirmQuote.useMutation({ onSuccess: refresh, onError });
  const recordPayment = trpc.staffBooking.recordPayment.useMutation({ onSuccess: refresh, onError });
  const markNoShow = trpc.staffBooking.markNoShow.useMutation({ onSuccess: refresh, onError });
  const markOverdue = trpc.staffBooking.markOverdue.useMutation({ onSuccess: refresh, onError });
  const markReturned = trpc.staffBooking.markReturned.useMutation({ onSuccess: refresh, onError });
  const markDisputed = trpc.staffBooking.markDisputed.useMutation({ onSuccess: refresh, onError });
  const resolveDispute = trpc.staffBooking.resolveDispute.useMutation({ onSuccess: refresh, onError });
  const completeFromReturned = trpc.staffBooking.completeFromReturned.useMutation({ onSuccess: refresh, onError });
  const closeOut = trpc.staffBooking.closeOut.useMutation({ onSuccess: refresh, onError });

  type Option = { label: string; onSelect: () => void; destructive?: boolean };
  const options: Option[] = [];
  const href = (path: string) => () => router.push(path);

  if (status === "QUOTE") options.push({ label: "→ Pending payment", onSelect: () => setPrompt("confirmQuote") });
  // Phase B — "Record payment" lives in the unified Payment Console on the
  // Payments & charges tab now. Kept as a quick link so staff with
  // existing muscle-memory still land where they expect.
  if (["QUOTE", "PENDING_PAYMENT", "CONFIRMED"].includes(status) && balanceDue > 0)
    options.push({
      label: `Open payment console (A$${balanceDue.toFixed(2)} due)`,
      onSelect: () => {
        const url = `${window.location.pathname}?tab=payments`;
        window.location.href = url;
      },
    });
  if (["QUOTE", "PENDING_PAYMENT", "CONFIRMED"].includes(status))
    options.push({
      label: balanceDue > 0 ? `Record payment (A$${balanceDue.toFixed(2)} due)` : "Record payment",
      onSelect: () => setPrompt("recordPayment"),
    });
  if (["CONFIRMED", "PENDING_PAYMENT"].includes(status))
    options.push({ label: "→ Check out", onSelect: href(`/staff/bookings/${bookingId}/check-out`) });
  if (["CONFIRMED", "PENDING_PAYMENT", "QUOTE"].includes(status) && pickupPassed)
    options.push({ label: "→ No show", onSelect: () => setPrompt("markNoShow") });
  if (["ACTIVE", "CHECKED_OUT"].includes(status))
    options.push({ label: "→ Overdue", onSelect: () => setPrompt("markOverdue") });
  if (["ACTIVE", "OVERDUE", "CHECKED_OUT"].includes(status)) {
    if (hasSignedReturnAssessment) {
      // Check-in wizard is done and the return assessment is signed;
      // the only meaningful close-out is "→ Completed". Drop the
      // misleading "skip settlement" path here.
      options.push({ label: "→ Completed", onSelect: () => setPrompt("closeOut") });
    } else {
      options.push({ label: "→ Check in", onSelect: href(`/staff/bookings/${bookingId}/check-in`) });
      options.push({ label: "→ Returned (skip settlement)", onSelect: () => setPrompt("markReturned") });
    }
  }
  if (status === "RETURNED") options.push({ label: "→ Completed", onSelect: () => setPrompt("completeFromReturned") });
  if (!["CANCELLED", "DISPUTED", "NO_SHOW"].includes(status))
    options.push({ label: "→ Disputed", onSelect: () => setPrompt("markDisputed") });
  if (status === "DISPUTED") options.push({ label: "Resolve dispute", onSelect: () => setPrompt("resolveDispute") });
  // Mirrors CANCELLABLE_STATUSES in src/server/services/booking-cancellation.ts —
  // once the vehicle is checked out, the close-out path is Check-in / Return.
  if (["QUOTE", "PENDING_PAYMENT", "CONFIRMED"].includes(status))
    options.push({ label: "→ Cancelled", onSelect: href(`/staff/bookings/${bookingId}/cancel`), destructive: true });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={options.length === 0}>
              Change status <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            {options.map((o, i) => (
              <div key={i}>
                {i > 0 && o.destructive && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  className={o.destructive ? "text-destructive focus:text-destructive" : ""}
                  onSelect={o.onSelect}
                >
                  {o.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {err && <div className="text-destructive text-sm">{err}</div>}

      {prompt === "confirmQuote" && (
        <ReasonInline onCancel={() => setPrompt(null)} pending={confirmQuote.isPending} onSubmit={(r) => confirmQuote.mutate({ bookingId, reason: r })} placeholder="Reason (optional)" />
      )}
      {prompt === "recordPayment" && (
        <RecordPaymentInline
          balanceDue={balanceDue}
          onCancel={() => setPrompt(null)}
          pending={recordPayment.isPending}
          onSubmit={(v) => recordPayment.mutate({ bookingId, ...v })}
        />
      )}
      {prompt === "markNoShow" && (
        <NoShowInline onCancel={() => setPrompt(null)} pending={markNoShow.isPending} onSubmit={(v) => markNoShow.mutate({ bookingId, ...v })} />
      )}
      {prompt === "markOverdue" && (
        <ReasonInline onCancel={() => setPrompt(null)} pending={markOverdue.isPending} onSubmit={(r) => markOverdue.mutate({ bookingId, reason: r })} placeholder="Reason (optional)" />
      )}
      {prompt === "markReturned" && (
        <ReturnedInline onCancel={() => setPrompt(null)} pending={markReturned.isPending} onSubmit={(v) => markReturned.mutate({ bookingId, ...v })} />
      )}
      {prompt === "markDisputed" && (
        <ReasonInline required onCancel={() => setPrompt(null)} pending={markDisputed.isPending} onSubmit={(r) => markDisputed.mutate({ bookingId, reason: r })} placeholder="Dispute reason (required)" />
      )}
      {prompt === "resolveDispute" && (
        <ResolveInline onCancel={() => setPrompt(null)} pending={resolveDispute.isPending} onSubmit={(v) => resolveDispute.mutate({ bookingId, ...v })} />
      )}
      {prompt === "completeFromReturned" && (
        <ReasonInline onCancel={() => setPrompt(null)} pending={completeFromReturned.isPending} onSubmit={(r) => completeFromReturned.mutate({ bookingId, notes: r })} placeholder="Settlement notes (optional)" />
      )}
      {prompt === "closeOut" && (
        <ReturnedInline
          onCancel={() => setPrompt(null)}
          pending={closeOut.isPending}
          onSubmit={(v) => closeOut.mutate({ bookingId, ...v })}
        />
      )}
    </div>
  );
}

function InlinePanel({ onCancel, children }: { onCancel: () => void; children: React.ReactNode }) {
  return (
    <div className="border rounded-md p-3 bg-muted/30 space-y-3 max-w-xl">
      {children}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Close</Button>
      </div>
    </div>
  );
}

function ReasonInline({
  onCancel,
  onSubmit,
  pending,
  placeholder,
  required,
}: {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
  pending: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <InlinePanel onCancel={onCancel}>
      <div className="flex gap-2">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
        <Button size="sm" disabled={pending || (required && !reason.trim())} onClick={() => onSubmit(reason)}>
          {pending ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </InlinePanel>
  );
}

function RecordPaymentInline({
  balanceDue,
  onCancel,
  onSubmit,
  pending,
}: {
  balanceDue: number;
  onCancel: () => void;
  onSubmit: (v: { amount: number; method: "CARD" | "CASH" | "BANK_TRANSFER" | "STRIPE"; reference?: string; notes?: string }) => void;
  pending: boolean;
}) {
  const [amount, setAmount] = useState(balanceDue > 0 ? balanceDue.toFixed(2) : "");
  const [method, setMethod] = useState<"CARD" | "CASH" | "BANK_TRANSFER" | "STRIPE">("CARD");
  const [reference, setReference] = useState("");
  return (
    <InlinePanel onCancel={onCancel}>
      <div className="grid grid-cols-3 gap-2 items-end">
        <div>
          <Label className="text-xs">Amount</Label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Method</Label>
          <select
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            <option value="CARD">Card</option>
            <option value="CASH">Cash</option>
            <option value="BANK_TRANSFER">Transfer</option>
            <option value="STRIPE">Stripe</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Reference</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <Button
        size="sm"
        disabled={pending || !amount || Number(amount) <= 0}
        onClick={() => onSubmit({ amount: Number(amount), method, reference: reference || undefined })}
      >
        {pending ? "Saving…" : "Record payment"}
      </Button>
    </InlinePanel>
  );
}

function NoShowInline({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (v: { applyFee: boolean; reason?: string }) => void;
  pending: boolean;
}) {
  const [applyFee, setApplyFee] = useState(true);
  const [reason, setReason] = useState("");
  return (
    <InlinePanel onCancel={onCancel}>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={applyFee} onChange={(e) => setApplyFee(e.target.checked)} />
        Apply no-show fee
      </label>
      <div className="flex gap-2">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
        <Button size="sm" disabled={pending} onClick={() => onSubmit({ applyFee, reason: reason || undefined })}>
          {pending ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </InlinePanel>
  );
}

function ReturnedInline({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (v: { odometerKm?: number; notes?: string }) => void;
  pending: boolean;
}) {
  const [odo, setOdo] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <InlinePanel onCancel={onCancel}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Odometer (km)</Label>
          <Input type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => onSubmit({ odometerKm: odo ? Number(odo) : undefined, notes: notes || undefined })}
      >
        {pending ? "Saving…" : "Mark returned"}
      </Button>
    </InlinePanel>
  );
}

function ResolveInline({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (v: { resolveTo: "COMPLETED" | "CANCELLED" | "ACTIVE" | "OVERDUE"; notes?: string }) => void;
  pending: boolean;
}) {
  const [resolveTo, setResolveTo] = useState<"COMPLETED" | "CANCELLED" | "ACTIVE" | "OVERDUE">("COMPLETED");
  const [notes, setNotes] = useState("");
  return (
    <InlinePanel onCancel={onCancel}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Resolve to</Label>
          <select
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            value={resolveTo}
            onChange={(e) => setResolveTo(e.target.value as typeof resolveTo)}
          >
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ACTIVE">Active</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <Button size="sm" disabled={pending} onClick={() => onSubmit({ resolveTo, notes: notes || undefined })}>
        {pending ? "Saving…" : "Resolve"}
      </Button>
    </InlinePanel>
  );
}
