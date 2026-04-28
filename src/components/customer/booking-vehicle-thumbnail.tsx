"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  src: string | null;
  alt: string;
};

export function BookingVehicleThumbnail({ src, alt }: Props) {
  if (!src) return null;

  return (
    <Dialog>
      <DialogTrigger
        type="button"
        aria-label={`Preview ${alt}`}
        className="relative z-10 shrink-0 self-start overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="block h-24 w-auto rounded-md transition hover:scale-[1.02]"
        />
      </DialogTrigger>
      <DialogContent className="max-w-3xl overflow-hidden p-0 sm:rounded-lg">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] w-full bg-muted object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}
