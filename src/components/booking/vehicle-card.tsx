"use client";

import * as React from "react";
import Image from "next/image";
import { Camera, Check } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { VehicleSpecSheet } from "./vehicle-spec-sheet";
import { VehicleImageLightbox } from "./vehicle-image-lightbox";
import { VehicleMakeLogo } from "./vehicle-make-logo";

export type VehicleCardVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  colour: string;
  condition: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  currentOdometerKm: number;
  internalCode: string;
  category: { name: string; engineCapacity: number };
  depot: { name: string };
  images: { url: string; isPrimary: boolean; displayOrder: number; caption?: string | null }[];
};

export function VehicleCard({
  vehicle,
  selected,
  onSelect,
  compact,
}: {
  vehicle: VehicleCardVehicle;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const [specOpen, setSpecOpen] = React.useState(false);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);

  const hero = vehicle.images.find((i) => i.isPrimary) ?? vehicle.images[0] ?? null;
  const hasMultiplePhotos = vehicle.images.length > 1;

  return (
    <>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "group relative flex w-full flex-col overflow-hidden rounded-md border bg-card text-left text-card-foreground transition-all",
          "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          selected ? "border-primary ring-2 ring-primary/40" : "border-border",
        )}
      >
        <div className={cn("relative w-full bg-muted", compact ? "aspect-[5/3]" : "aspect-[4/3]")}>
          {hero ? (
            <Image
              src={hero.url}
              alt={`${vehicle.make} ${vehicle.model}`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="caption">Photo coming soon</span>
            </div>
          )}
          {hasMultiplePhotos && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setLightboxOpen(true);
                }
              }}
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/85"
            >
              <Camera className="h-3 w-3" />
              {vehicle.images.length}
            </span>
          )}
          {selected && (
            <span className="absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
              <Check className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        <div className={cn("flex flex-1 flex-col gap-1.5", compact ? "p-2.5" : "p-3")}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <VehicleMakeLogo make={vehicle.make} size={14} />
                <div className="caption uppercase tracking-[0.08em]">{vehicle.year}</div>
              </div>
              <h3 className="mt-0.5 truncate text-sm font-semibold leading-tight text-foreground">
                {vehicle.make} {vehicle.model}
              </h3>
              <div className="caption truncate">{vehicle.colour}</div>
            </div>
            <StatusBadge status={vehicle.condition} />
          </div>
          {!compact && (
            <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
              <div className="flex items-baseline justify-between">
                <dt className="caption">Engine</dt>
                <dd className="font-medium tabular-nums">{vehicle.category.engineCapacity}cc</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="caption">Km</dt>
                <dd className="font-medium tabular-nums">{vehicle.currentOdometerKm.toLocaleString()}</dd>
              </div>
            </dl>
          )}
          {!compact && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setSpecOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSpecOpen(true);
                }
              }}
              className="mt-auto self-start text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              View full specs
            </span>
          )}
        </div>
      </button>

      <VehicleSpecSheet vehicleId={vehicle.id} open={specOpen} onOpenChange={setSpecOpen} />
      <VehicleImageLightbox vehicleId={vehicle.id} open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}

export function NoPreferenceCard({
  selected,
  onSelect,
}: {
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-md border p-3 text-left transition-all",
        "hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/40"
          : "border-dashed border-border bg-card text-card-foreground",
      )}
    >
      <span
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm font-semibold",
            selected ? "text-primary" : "text-foreground",
          )}
        >
          No preference — let us pick the best match
        </div>
        <div
          className={cn(
            "caption mt-0.5",
            selected ? "text-primary/80" : undefined,
          )}
        >
          We&apos;ll allocate a well-maintained vehicle at checkout.
        </div>
      </div>
    </button>
  );
}
