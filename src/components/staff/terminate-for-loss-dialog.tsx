"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

type Cause = "WRITTEN_OFF" | "STOLEN" | "DESTROYED" | "OTHER";
type RefundMode = "REFUND" | "CREDIT" | "FORFEIT";
type BondDisposition = "RELEASED" | "HELD_FOR_CLAIM" | "CAPTURED_VIA_INCIDENT";

type IncidentOption = {
  id: string;
  incidentNumber: string;
  type: string;
  customerLiable: boolean;
};

type Props = {
  bookingId: string;
  status: string;
  /** Only managers may submit; staff see nothing (server re-gates anyway). */
  canTerminate: boolean;
  /** Open incidents on this booking, offered for linkage. */
  incidents?: IncidentOption[];
};

const TERMINATE_ALLOWED = ["ACTIVE", "CHECKED_OUT", "OVERDUE"] as const;

const CAUSE_LABELS: Record<Cause, string> = {
  WRITTEN_OFF: "Written off",
  STOLEN: "Stolen",
  DESTROYED: "Destroyed",
  OTHER: "Other loss",
};

/** Locked decision: manager chooses per case; the UI only PRE-SELECTS —
 *  REFUND for company-side causes, FORFEIT for customer-caused theft. */
const DEFAULT_REFUND_MODE: Record<Cause, RefundMode> = {
  WRITTEN_OFF: "REFUND",
  DESTROYED: "REFUND",
  OTHER: "REFUND",
  STOLEN: "FORFEIT",
};

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Mid-hire loss termination (Area 2). Manager-only dialog on the staff
 * booking detail page for in-flight hires: pick the cause, when the loss
 * happened, how the unused days settle (refund / gift-card credit /
 * forfeit), what happens to the bond, and optionally link the incident.
 * The preview panel shows the live server quote so the manager sees the
 * write-down / refund before committing.
 */
export function TerminateForLossDialog({
  bookingId,
  status,
  canTerminate,
  incidents = [],
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cause, setCause] = useState<Cause>("WRITTEN_OFF");
  const [lossAtLocal, setLossAtLocal] = useState(() => toLocalInputValue(new Date()));
  const [refundMode, setRefundMode] = useState<RefundMode>(
    DEFAULT_REFUND_MODE.WRITTEN_OFF,
  );
  const [waiveLateFees, setWaiveLateFees] = useState(false);
  const hasLiableIncident = incidents.some((i) => i.customerLiable);
  const [bondDisposition, setBondDisposition] = useState<BondDisposition>(
    hasLiableIncident ? "HELD_FOR_CLAIM" : "RELEASED",
  );
  const [incidentId, setIncidentId] = useState<string>(
    incidents.find((i) => i.customerLiable)?.id ?? "",
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const lossAt = useMemo(() => {
    const d = new Date(lossAtLocal);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [lossAtLocal]);

  const preview = trpc.staffBooking.previewLossTermination.useQuery(
    {
      bookingId,
      lossAt: lossAt ?? undefined,
      refundMode,
      waiveAccruedLateFees: waiveLateFees,
    },
    { enabled: open && lossAt !== null, retry: false },
  );

  const terminate = trpc.staffBooking.terminateForLoss.useMutation({
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Termination failed"),
  });

  if (!canTerminate) return null;
  if (!(TERMINATE_ALLOWED as readonly string[]).includes(status)) return null;

  const onCauseChange = (next: Cause) => {
    setCause(next);
    // Pre-selection follows the cause; the manager can still override.
    setRefundMode(DEFAULT_REFUND_MODE[next]);
  };

  const submit = () => {
    if (!lossAt) return;
    setError(null);
    terminate.mutate({
      bookingId,
      cause,
      lossAt,
      refundMode,
      waiveAccruedLateFees: waiveLateFees,
      incidentId: incidentId || undefined,
      bondDisposition,
      notes: notes.trim() || undefined,
    });
  };

  const q = preview.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Terminate for loss
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Terminate hire — vehicle lost</DialogTitle>
          <DialogDescription>
            Ends the booking at the loss time, cancels post-loss late fees, writes the
            invoice down to the days actually used and settles the unused days per the
            chosen mode. The vehicle&apos;s status is managed separately via Fleet.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="term-cause">Cause</Label>
            <Select value={cause} onValueChange={(v) => onCauseChange(v as Cause)}>
              <SelectTrigger id="term-cause">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CAUSE_LABELS) as Cause[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CAUSE_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="term-loss-at">Loss date &amp; time</Label>
            <Input
              id="term-loss-at"
              type="datetime-local"
              value={lossAtLocal}
              onChange={(e) => setLossAtLocal(e.target.value)}
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Unused days settlement</legend>
          {(
            [
              ["REFUND", "Refund — return the unused days to the payment method"],
              ["CREDIT", "Credit — issue the unused days as a gift card"],
              ["FORFEIT", "Forfeit — customer keeps no claim on the unused days"],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="term-refund-mode"
                className="mt-0.5"
                checked={refundMode === mode}
                onChange={() => setRefundMode(mode)}
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={waiveLateFees}
              onChange={(e) => setWaiveLateFees(e.target.checked)}
            />
            <span>
              Also waive uncollected pre-loss late fees (post-loss late fees are always
              cancelled)
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Bond</legend>
          {(
            [
              ["RELEASED", "Release the bond hold now"],
              ["HELD_FOR_CLAIM", "Keep held for an incident claim"],
              ["CAPTURED_VIA_INCIDENT", "Already captured via the incident charge"],
            ] as const
          ).map(([d, label]) => (
            <label key={d} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="term-bond"
                className="mt-0.5"
                checked={bondDisposition === d}
                onChange={() => setBondDisposition(d)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        {incidents.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="term-incident">Linked incident (optional)</Label>
            <Select
              value={incidentId || "none"}
              onValueChange={(v) => setIncidentId(v === "none" ? "" : v)}
            >
              <SelectTrigger id="term-incident">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {incidents.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.incidentNumber} — {i.type.replace(/_/g, " ")}
                    {i.customerLiable ? " (customer liable)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="term-notes">Notes (internal)</Label>
          <Input
            id="term-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. insurer claim ref, police event number"
          />
        </div>

        {/* Live server quote */}
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          {preview.isLoading && (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Calculating…
            </span>
          )}
          {preview.error && (
            <span className="text-destructive">{preview.error.message}</span>
          )}
          {q && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Unused days</dt>
              <dd className="text-right tabular-nums">{q.unusedDays}</dd>
              <dt className="text-muted-foreground">Unused value</dt>
              <dd className="text-right tabular-nums">
                {formatCurrency(q.grossUnusedValue)}
              </dd>
              <dt className="text-muted-foreground">Invoice write-down</dt>
              <dd className="text-right tabular-nums">
                {formatCurrency(q.writedownAmount)}
              </dd>
              <dt className="text-muted-foreground">
                {refundMode === "CREDIT" ? "Gift-card credit" : "Refund to customer"}
              </dt>
              <dd className="text-right tabular-nums">{formatCurrency(q.cashRefund)}</dd>
              <dt className="text-muted-foreground">Late fees cancelled</dt>
              <dd className="text-right tabular-nums">
                {formatCurrency(q.postLossLateFeeCancel + q.preLossLateFeeWaive)}
              </dd>
              <dt className="text-muted-foreground">Balance after</dt>
              <dd className="text-right tabular-nums">
                {formatCurrency(q.projectedBalanceDue)}
              </dd>
              <dt className="text-muted-foreground">Bond currently held</dt>
              <dd className="text-right tabular-nums">
                {formatCurrency(q.bondHeldRemaining)}
              </dd>
            </dl>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={terminate.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={terminate.isPending || !lossAt || !q}
          >
            {terminate.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Terminate hire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
