"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { VehicleEditSheet, type VehicleEditSection } from "./vehicle-edit-sheet";

/**
 * Wrapper around VehicleEditSheet used from the fleet audit list.
 *
 * The audit row only knows the vehicle id and which section the check wants
 * edited, not the full `VehicleWithRelations` the sheet needs. This
 * component lazy-fetches that detail via `fleet.vehicleDetail` and mounts
 * the sheet once it arrives. Closing the sheet invalidates
 * `fleet.auditVehicles` so fixed issues drop off the list automatically.
 */
export function VehicleFixSheet({
  target,
  onClose,
}: {
  target: { vehicleId: string; section: VehicleEditSection } | null;
  onClose: () => void;
}) {
  const enabled = target !== null;
  const { data } = trpc.fleet.vehicleDetail.useQuery(
    { id: target?.vehicleId ?? "" },
    { enabled },
  );
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!enabled) return;
    return () => {
      utils.fleet.auditVehicles.invalidate();
    };
  }, [enabled, utils]);

  if (!target || !data) return null;

  return (
    <VehicleEditSheet
      section={target.section}
      vehicle={data.vehicle}
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    />
  );
}
