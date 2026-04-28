"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc/client";
import { VehicleCard, type VehicleCardVehicle } from "./vehicle-card";

type UniqueVehicle = VehicleCardVehicle & { lastRentedAt: Date };

export function PreviouslyRentedRow({
  categoryId,
  selectedVehicleId,
  onSelect,
}: {
  categoryId: string;
  selectedVehicleId: string | null;
  onSelect: (vehicleId: string) => void;
}) {
  const { data: session } = useSession();
  const enabled = !!session;

  const { data } = trpc.booking.mine.useQuery(
    { limit: 50 },
    { enabled },
  );

  const vehicles: UniqueVehicle[] = React.useMemo(() => {
    if (!data) return [];
    const byId = new Map<string, UniqueVehicle>();
    for (const b of data.items) {
      if (!b.vehicle) continue;
      if (!(b.status === "COMPLETED" || b.status === "RETURNED")) continue;
      if (b.vehicle.categoryId !== categoryId) continue;
      const existing = byId.get(b.vehicle.id);
      const lastRentedAt = new Date(b.returnDateTime);
      if (!existing || existing.lastRentedAt < lastRentedAt) {
        byId.set(b.vehicle.id, {
          id: b.vehicle.id,
          make: b.vehicle.make,
          model: b.vehicle.model,
          year: b.vehicle.year,
          colour: b.vehicle.colour,
          condition: b.vehicle.condition as UniqueVehicle["condition"],
          currentOdometerKm: b.vehicle.currentOdometerKm,
          internalCode: b.vehicle.internalCode,
          category: b.vehicle.category,
          depot: b.vehicle.depot,
          images: b.vehicle.images,
          lastRentedAt,
        });
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => b.lastRentedAt.getTime() - a.lastRentedAt.getTime(),
    );
  }, [data, categoryId]);

  if (!enabled || vehicles.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="h3 text-base">Ridden one of these before?</h3>
        <p className="caption">One click to rebook a vehicle you&apos;ve had from us.</p>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 snap-x sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
        {vehicles.slice(0, 6).map((v) => (
          <div
            key={v.id}
            className="min-w-[240px] shrink-0 snap-start sm:min-w-0 sm:shrink"
          >
            <VehicleCard
              vehicle={v}
              selected={selectedVehicleId === v.id}
              onSelect={() => onSelect(v.id)}
              compact
            />
          </div>
        ))}
      </div>
    </section>
  );
}
