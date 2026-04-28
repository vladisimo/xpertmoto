import { prisma } from "@/lib/prisma";
import { FleetVehiclesTable, type FleetVehicleRow } from "./fleet-vehicles-table";
import { FleetVehiclesFilterBar } from "./fleet-vehicles-filter-bar";
import { VehicleStatus } from "@prisma/client";
import { getDepotList } from "@/server/queries/cached";

const FLEET_VEHICLES_CAP = 500;

export async function FleetVehiclesTab({
  status,
  q,
  depotId,
}: {
  status?: string;
  q?: string;
  depotId?: string;
}) {
  const [vehicles, depots] = await Promise.all([
    prisma.vehicle.findMany({
      where: {
        isActive: true,
        ...(status ? { status: status as VehicleStatus } : {}),
        ...(depotId ? { depotId } : {}),
        ...(q
          ? {
              OR: [
                { internalCode: { contains: q, mode: "insensitive" } },
                { rego: { contains: q, mode: "insensitive" } },
                { make: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        internalCode: true,
        rego: true,
        regoExpiry: true,
        make: true,
        model: true,
        year: true,
        colour: true,
        status: true,
        category: { select: { name: true } },
        depot: { select: { name: true } },
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { url: true },
        },
      },
      orderBy: { internalCode: "asc" },
      take: FLEET_VEHICLES_CAP + 1,
    }),
    getDepotList(),
  ]);

  const truncated = vehicles.length > FLEET_VEHICLES_CAP;
  const capped = truncated ? vehicles.slice(0, FLEET_VEHICLES_CAP) : vehicles;

  const rows: FleetVehicleRow[] = capped.map((v) => ({
    id: v.id,
    internalCode: v.internalCode,
    rego: v.rego,
    regoExpiry: v.regoExpiry,
    make: v.make,
    model: v.model,
    year: v.year,
    colour: v.colour,
    status: v.status,
    thumbnailUrl: v.images[0]?.url ?? null,
    categoryName: v.category.name,
    depotName: v.depot.name,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <FleetVehiclesFilterBar depots={depots} initial={{ q, status, depotId }} />
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {FLEET_VEHICLES_CAP} vehicles. Narrow your filters to see the rest.
        </p>
      ) : null}

      <FleetVehiclesTable data={rows} />
    </div>
  );
}
