"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  bookingId: string;
};

type Mode = "idle" | "auto" | "manual";

export function UnallocatedVehicleBanner({ bookingId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const candidates = trpc.staffBooking.listAllocationCandidates.useQuery(
    { bookingId },
    { enabled: mode === "manual" },
  );

  const refresh = () => {
    setMode("idle");
    setSelectedVehicleId("");
    setReason("");
    setError(null);
    router.refresh();
  };
  const onError = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Action failed");

  const assign = trpc.staffBooking.assignVehicle.useMutation({
    onSuccess: refresh,
    onError,
  });

  const handleAuto = () => {
    setError(null);
    setMode("auto");
    assign.mutate({ bookingId, reason: reason.trim() || undefined });
  };
  const handleManualConfirm = () => {
    if (!selectedVehicleId) return;
    setError(null);
    assign.mutate({
      bookingId,
      vehicleId: selectedVehicleId,
      reason: reason.trim() || undefined,
    });
  };

  const freeCandidates =
    candidates.data?.eligible && candidates.data.vehicles
      ? candidates.data.vehicles.filter((v) => v.free)
      : [];
  const blockedCount =
    candidates.data?.eligible && candidates.data.vehicles
      ? candidates.data.vehicles.length - freeCandidates.length
      : 0;

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertOctagon className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-semibold">No vehicle allocated to this booking</div>
          <p className="text-xs text-muted-foreground">
            Staff didn&apos;t record a vehicle at check-out. Assign one now to clear the calendar mistake.
            The vehicle will be marked <span className="font-medium">RENTED</span> and the action logged on the booking.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pl-8">
        <Button
          size="sm"
          onClick={handleAuto}
          disabled={assign.isPending}
        >
          {assign.isPending && mode === "auto" && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          )}
          1. Auto-allocate best match
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setError(null);
            setMode((m) => (m === "manual" ? "idle" : "manual"));
          }}
        >
          {mode === "manual" ? (
            <ChevronDown className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          2. Pick manually
        </Button>
        <span className="text-xs text-muted-foreground self-center">
          3. No vehicles available? Use <span className="font-medium">Change status → Disputed</span> above to escalate.
        </span>
      </div>

      {mode === "manual" && (
        <div className="ml-8 rounded-md border border-border bg-background p-3 space-y-3">
          {candidates.isLoading && (
            <p className="text-xs text-muted-foreground">Loading candidates…</p>
          )}
          {candidates.data && !candidates.data.eligible && (
            <p className="text-xs text-muted-foreground">
              Booking is no longer in an unallocated state.
            </p>
          )}
          {candidates.data?.eligible && freeCandidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No AVAILABLE vehicles in this category at this depot are free for the
              remaining rental window.
              {blockedCount > 0 && ` (${blockedCount} blocked by other bookings or maintenance.)`}
            </p>
          )}
          {candidates.data?.eligible && freeCandidates.length > 0 && (
            <>
              <div>
                <Label className="text-xs">Vehicle</Label>
                <Select
                  value={selectedVehicleId}
                  onValueChange={setSelectedVehicleId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a vehicle…" />
                  </SelectTrigger>
                  <SelectContent>
                    {freeCandidates.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.internalCode} · {v.rego} · {v.currentOdometerKm.toLocaleString()} km · {v.condition}
                        {v.docsExpiringDuringRental.length > 0 &&
                          ` · ⚠️ ${v.docsExpiringDuringRental.join(", ")} expiring`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {blockedCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {blockedCount} other vehicle{blockedCount === 1 ? "" : "s"} in this category at this depot are blocked by overlapping bookings or maintenance.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Reason (optional, recorded on booking)</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. handover paperwork missed, recovered from staff diary"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleManualConfirm}
                  disabled={!selectedVehicleId || assign.isPending}
                >
                  {assign.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  )}
                  Assign vehicle
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="ml-8 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
