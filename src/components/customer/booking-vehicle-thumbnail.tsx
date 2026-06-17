"use client";

import Image from "next/image";

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
        {/* Unknown intrinsic dimensions (vehicle photos vary): width/height 0
            + sizes lets the optimiser pick a resolution while CSS drives the
            rendered size. Fixed 6rem height, auto width. */}
        <Image
          src={src}
          alt={alt}
          width={0}
          height={0}
          sizes="120px"
          className="block h-24 w-auto rounded-md transition hover:scale-[1.02]"
          style={{ width: "auto", height: "6rem" }}
        />
      </DialogTrigger>
      <DialogContent className="max-w-3xl overflow-hidden p-0 sm:rounded-lg">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <Image
          src={src}
          alt={alt}
          width={0}
          height={0}
          sizes="(max-width: 768px) 100vw, 768px"
          className="max-h-[80vh] w-full bg-muted object-contain"
          style={{ height: "auto" }}
        />
      </DialogContent>
    </Dialog>
  );
}
