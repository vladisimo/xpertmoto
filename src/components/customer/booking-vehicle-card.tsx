import Image from "next/image";
import { ImageIcon } from "lucide-react";

type VehicleImage = { url: string; caption: string | null; isPrimary: boolean };

type VehicleSnapshot = {
  make: string;
  model: string;
  year: number;
  colour: string;
  rego: string;
  regoState: string;
  internalCode: string;
  images?: VehicleImage[];
} | null;

export function BookingVehicleCard({
  vehicle,
  categoryName,
  categoryImageUrl,
}: {
  vehicle: VehicleSnapshot;
  categoryName: string;
  categoryImageUrl?: string | null;
}) {
  const vehicleImage = vehicle?.images?.[0];
  const heroSrc = vehicleImage?.url ?? categoryImageUrl ?? null;
  const heroAlt =
    vehicleImage?.caption ??
    (vehicle
      ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
      : categoryName);
  const title = vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
    : categoryName;

  return (
    <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="relative aspect-[16/9] w-full bg-muted">
        {heroSrc ? (
          <Image
            src={heroSrc}
            alt={heroAlt}
            fill
            className="object-contain"
            sizes="(max-width: 640px) 100vw, 768px"
            priority
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center gap-2 text-caption text-muted-foreground">
            <ImageIcon className="h-4 w-4" aria-hidden />
            {vehicle ? "No photo on file" : "Vehicle assigned at pickup"}
          </div>
        )}
      </div>

      <div className="space-y-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {categoryName}
            </p>
            <h3 className="h3 truncate">{title}</h3>
          </div>
          {vehicle && (
            <div className="flex flex-col items-end leading-none">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Rego ({vehicle.regoState})
              </span>
              <span className="mt-1 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-base font-semibold tracking-wider sm:text-lg">
                {vehicle.rego}
              </span>
            </div>
          )}
        </div>

        {vehicle && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Colour
              </dt>
              <dd>{vehicle.colour}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Fleet code
              </dt>
              <dd className="font-mono">{vehicle.internalCode}</dd>
            </div>
          </dl>
        )}

        {!vehicle && (
          <p className="text-sm text-muted-foreground">
            Your specific {categoryName.toLowerCase()} is allocated by the depot
            team at pickup. You&apos;ll see the registration here once it&apos;s
            assigned.
          </p>
        )}
      </div>
    </div>
  );
}
