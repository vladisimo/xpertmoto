"use client";

import * as React from "react";
import Image from "next/image";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SpecTable, type SpecRow } from "@/components/marketing/spec-table";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function VehicleSpecSheet({
  vehicleId,
  open,
  onOpenChange,
}: {
  vehicleId: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { data, isLoading } = trpc.vehicle.byId.useQuery(
    { id: vehicleId ?? "" },
    { enabled: open && !!vehicleId },
  );

  const model = data?.catalogueModel ?? null;

  const catalogueRows: SpecRow[] = React.useMemo(() => {
    if (!model) return [];
    const rows: SpecRow[] = [];
    if (model.engineCapacityCc) rows.push({ label: "Engine", value: `${model.engineCapacityCc} cc` });
    if (model.enginePowerKw) rows.push({ label: "Power", value: `${Number(model.enginePowerKw)} kW` });
    if (model.engineTorqueNm) rows.push({ label: "Torque", value: `${Number(model.engineTorqueNm)} Nm` });
    if (model.fuelType) rows.push({ label: "Fuel", value: model.fuelType });
    if (model.fuelTankLitres) rows.push({ label: "Tank", value: `${Number(model.fuelTankLitres)} L` });
    if (model.topSpeedKmh) rows.push({ label: "Top speed", value: `${model.topSpeedKmh} km/h` });
    if (model.dryWeightKg) rows.push({ label: "Dry weight", value: `${Number(model.dryWeightKg)} kg` });
    if (model.seatHeightMm) rows.push({ label: "Seat height", value: `${model.seatHeightMm} mm` });
    if (model.tyreFront) rows.push({ label: "Front tyre", value: model.tyreFront });
    if (model.tyreRear) rows.push({ label: "Rear tyre", value: model.tyreRear });
    if (model.serviceIntervalKm)
      rows.push({ label: "Service interval", value: `${model.serviceIntervalKm.toLocaleString()} km` });
    return rows;
  }, [model]);

  const instanceRows: SpecRow[] = React.useMemo(() => {
    if (!data) return [];
    return [
      { label: "Year", value: data.year },
      { label: "Colour", value: data.colour },
      { label: "Odometer", value: `${data.currentOdometerKm.toLocaleString()} km` },
      { label: "Condition", value: <StatusBadge status={data.condition} /> },
      { label: "Rego", value: `${data.rego} (${data.regoState})` },
      { label: "Unit code", value: data.internalCode },
    ];
  }, [data]);

  const hero =
    data?.images?.find((i) => i.isPrimary) ??
    data?.images?.[0] ??
    null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {data ? `${data.make} ${data.model}` : "Vehicle details"}
          </SheetTitle>
          {data && (
            <SheetDescription>
              {data.category.name} · {data.depot.name}
            </SheetDescription>
          )}
        </SheetHeader>

        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}

        {data && (
          <div className="mt-6 space-y-6">
            {hero && (
              <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
                <Image src={hero.url} alt={`${data.make} ${data.model}`} fill sizes="480px" className="object-cover" />
              </div>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">This vehicle</h3>
              <SpecTable rows={instanceRows} />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Specifications</h3>
              {catalogueRows.length > 0 ? (
                <SpecTable rows={catalogueRows} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Full manufacturer specifications aren&apos;t on file for this model yet.
                </p>
              )}
              {model?.specsSourceName && model?.specsSourceUrl && (
                <p className="caption pt-1">
                  Source: <a className="underline" href={model.specsSourceUrl} target="_blank" rel="noreferrer">{model.specsSourceName}</a>
                </p>
              )}
            </section>

            {model?.documents && model.documents.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Manuals</h3>
                <ul className="space-y-1 text-sm">
                  {model.documents.map((d) => (
                    <li key={d.id}>
                      <a className={cn("text-primary underline")} href={d.fileUrl} target="_blank" rel="noreferrer">
                        {d.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
