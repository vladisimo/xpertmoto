"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function VehicleImageLightbox({
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

  const images = data?.images ?? [];
  const [index, setIndex] = React.useState(0);

  const openKey = open ? (vehicleId ?? "") : "";
  const [lastKey, setLastKey] = React.useState(openKey);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    setIndex(0);
  }

  const next = () => setIndex((i) => (i + 1) % Math.max(1, images.length));
  const prev = () => setIndex((i) => (i - 1 + images.length) % Math.max(1, images.length));

  const current = images[index];
  const title = data ? `${data.make} ${data.model}` : "Vehicle photos";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner />
            </div>
          )}
          {current && (
            <Image
              src={current.url}
              alt={current.caption ?? title}
              fill
              sizes="(max-width: 768px) 100vw, 800px"
              className="object-contain"
              priority
            />
          )}
          {!isLoading && images.length === 0 && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No photos available.
            </div>
          )}

          {images.length > 1 && (
            <>
              <Button
                variant="secondary"
                size="icon"
                onClick={prev}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full shadow"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={next}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full shadow"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-medium text-white">
                {index + 1} / {images.length}
              </div>
            </>
          )}
        </div>
        {current?.caption && (
          <p className="px-5 py-3 text-sm text-muted-foreground">{current.caption}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
