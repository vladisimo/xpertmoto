"use client";

import { useMemo, useState } from "react";
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

  const reset = () => {
    setTarget("AVAILABLE");
    setReason("");
    setSalePrice("");
  };

  const invalidate = async () => {
    await Promise.all([
      util.fleet.vehicleDetail.invalidate({ id: vehicle.id }),
      util.fleet.listVehicles.invalidate(),
      util.fleet.dashboard.invalidate(),
    ]);
  };

  const updateStatus = trpc.fleet.updateVehicleStatus.useMutation({
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
      reset();
    },
  });

  const decommission = trpc.fleet.decommission.useMutation({
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
      reset();
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

  const pending = updateStatus.isPending || decommission.isPending;
  const error = updateStatus.error?.message ?? decommission.error?.message;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
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
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !reason.trim()}>
              {pending ? "Saving…" : "Change status"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
