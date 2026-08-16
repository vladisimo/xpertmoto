"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";

type Target =
  | "AVAILABLE"
  | "PENDING"
  | "IN_MAINTENANCE"
  | "ACCIDENT_REPAIRS"
  | "STOLEN"
  | "WRITTEN_OFF"
  | "SOLD"
  | "END_OF_LIFE";

const TARGET_OPTIONS: Array<{ value: Target; label: string; description: string }> = [
  { value: "AVAILABLE", label: "Active", description: "Listed and bookable." },
  { value: "PENDING", label: "Pending", description: "In the fleet, not yet listed (awaiting photos / inspection / rego)." },
  { value: "IN_MAINTENANCE", label: "In maintenance", description: "Off-road for scheduled service." },
  { value: "ACCIDENT_REPAIRS", label: "Accident repairs", description: "Off-road for damage repair." },
  { value: "SOLD", label: "Sold", description: "Dispose: soft-deletes from the fleet. Records the sale price." },
  { value: "END_OF_LIFE", label: "End of life", description: "Dispose: retired without sale." },
  { value: "STOLEN", label: "Stolen", description: "Hard loss: future bookings auto-reassign." },
  { value: "WRITTEN_OFF", label: "Written off", description: "Hard loss: future bookings auto-reassign." },
];

const DISPOSITION = new Set<Target>(["SOLD", "END_OF_LIFE", "STOLEN", "WRITTEN_OFF"]);

type ReassignOutcome = {
  reassignment: {
    totalAffected: number;
    reassigned: Array<{ bookingId: string; reference: string; newVehicleId: string }>;
    needsManual: Array<{ bookingId: string; reference: string }>;
    quotesUnassigned: Array<{ bookingId: string; reference: string }>;
  };
  activeRentals: Array<{ id: string; bookingReference: string; status: string }>;
};

function BookingLinkList({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {items.map((b) => (
        <li key={b.id}>
          <Link
            href={`/staff/bookings/${b.id}`}
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            {b.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function VehicleChangeStatusDialog({
  vehicle,
  open,
  onOpenChange,
}: {
  vehicle: {
    id: string;
    internalCode: string;
    status: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const util = trpc.useUtils();
  const [target, setTarget] = useState<Target>("AVAILABLE");
  const [reason, setReason] = useState("");
  const [salePrice, setSalePrice] = useState<string>("");
  // Set after a disposition / hard-loss commit: swaps the form for a
  // results view so staff see exactly which bookings were touched.
  const [outcome, setOutcome] = useState<ReassignOutcome | null>(null);

  const reset = () => {
    setTarget("AVAILABLE");
    setReason("");
    setSalePrice("");
    setOutcome(null);
  };

  const invalidate = async () => {
    await Promise.all([
      util.fleet.vehicleDetail.invalidate({ id: vehicle.id }),
      util.fleet.listVehicles.invalidate(),
      util.fleet.dashboard.invalidate(),
    ]);
  };

  const updateStatus = trpc.fleet.updateVehicleStatus.useMutation({
    onSuccess: async (data) => {
      await invalidate();
      if (data.reassignment) {
        // Hard loss (STOLEN / WRITTEN_OFF): show what happened to the
        // vehicle's bookings instead of silently closing.
        setOutcome({ reassignment: data.reassignment, activeRentals: [] });
      } else {
        onOpenChange(false);
        reset();
      }
    },
  });

  const decommission = trpc.fleet.decommission.useMutation({
    onSuccess: async (data) => {
      await invalidate();
      setOutcome({ reassignment: data.reassignment, activeRentals: data.activeRentals });
    },
  });

  const selected = useMemo(
    () => TARGET_OPTIONS.find((o) => o.value === target) ?? TARGET_OPTIONS[0]!,
    [target],
  );

  const requiresSalePrice = target === "SOLD";
  const isDispose = DISPOSITION.has(target);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isDispose) {
      const reasonKey = target as "SOLD" | "END_OF_LIFE" | "STOLEN" | "WRITTEN_OFF";
      decommission.mutate({
        vehicleId: vehicle.id,
        reason: reasonKey,
        salePrice: salePrice ? Number(salePrice) : undefined,
        force: true,
      });
    } else {
      updateStatus.mutate({
        vehicleId: vehicle.id,
        status: target as "AVAILABLE" | "PENDING" | "IN_MAINTENANCE" | "ACCIDENT_REPAIRS",
        reason,
      });
    }
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  const pending = updateStatus.isPending || decommission.isPending;
  const error = updateStatus.error?.message ?? decommission.error?.message;

  const nothingAffected =
    outcome !== null &&
    outcome.reassignment.reassigned.length === 0 &&
    outcome.reassignment.needsManual.length === 0 &&
    outcome.reassignment.quotesUnassigned.length === 0 &&
    outcome.activeRentals.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {outcome ? (
          <>
            <DialogHeader>
              <DialogTitle>Status changed — {vehicle.internalCode}</DialogTitle>
              <DialogDescription>
                The vehicle has been removed from service. Here is what happened to its bookings.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {nothingAffected && (
                <div className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                  No bookings were affected by this change.
                </div>
              )}

              {outcome.reassignment.reassigned.length > 0 && (
                <div className="rounded-md border border-emerald-600/30 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <p className="font-medium">
                    Auto-reassigned to another vehicle ({outcome.reassignment.reassigned.length})
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">
                    Same category, same depot — the customer has been emailed.
                  </p>
                  <BookingLinkList
                    items={outcome.reassignment.reassigned.map((b) => ({
                      id: b.bookingId,
                      label: b.reference,
                    }))}
                  />
                </div>
              )}

              {outcome.reassignment.needsManual.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="font-medium">
                    Needs manual resolution ({outcome.reassignment.needsManual.length})
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">
                    No compatible replacement was available (or pickup has already passed).
                    Contact each customer to offer an upgrade, another depot, or a refund.
                    Depot managers have been notified.
                  </p>
                  <BookingLinkList
                    items={outcome.reassignment.needsManual.map((b) => ({
                      id: b.bookingId,
                      label: b.reference,
                    }))}
                  />
                </div>
              )}

              {outcome.reassignment.quotesUnassigned.length > 0 && (
                <div className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    Quote{outcome.reassignment.quotesUnassigned.length === 1 ? "" : "s"} detached
                    from this vehicle ({outcome.reassignment.quotesUnassigned.length})
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">
                    Unconfirmed quotes that referenced this vehicle were left unassigned — a
                    vehicle will be allocated if they convert. No customer action needed.
                  </p>
                  <BookingLinkList
                    items={outcome.reassignment.quotesUnassigned.map((b) => ({
                      id: b.bookingId,
                      label: b.reference,
                    }))}
                  />
                </div>
              )}

              {outcome.activeRentals.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">
                    Live hires on this vehicle ({outcome.activeRentals.length})
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">
                    These customers are currently out on the vehicle. Each hire needs staff
                    resolution from its booking page — terminate the hire or arrange a
                    replacement vehicle.
                    {/* TODO(area-2/3): link straight into the terminate-for-loss /
                        loss-replacement flows once they land. */}
                  </p>
                  <BookingLinkList
                    items={outcome.activeRentals.map((b) => ({
                      id: b.id,
                      label: `${b.bookingReference} — ${b.status}`,
                    }))}
                  />
                </div>
              )}
            </div>

            <DialogFooter className="sm:justify-end">
              <Button type="button" onClick={close}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Change status — {vehicle.internalCode}</DialogTitle>
              <DialogDescription>
                Current status: <StatusBadge status={vehicle.status as StatusKey} />.
                Rented, Reserved and In-transit are set automatically by the booking and transfer flows — use the check-in or transfer actions rather than this dialog.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="target-status">New status</Label>
                <Select value={target} onValueChange={(v) => setTarget(v as Target)}>
                  <SelectTrigger id="target-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{selected.description}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Reason</Label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  required
                  placeholder="Recorded on the status log for audit purposes."
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              {requiresSalePrice && (
                <div className="space-y-2">
                  <Label htmlFor="sale-price">Sale price (A$)</Label>
                  <Input
                    id="sale-price"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                  />
                </div>
              )}

              {isDispose && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  This is a disposition — the vehicle will be soft-deleted from the active fleet, and any future bookings will be auto-reassigned where possible.
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !reason.trim()}>
                  {pending ? "Saving…" : "Change status"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
