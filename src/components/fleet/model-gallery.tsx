"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ModelGalleryImage {
  id: string;
  url: string;
  caption: string | null;
}

export interface ModelGalleryProps {
  images: ModelGalleryImage[];
  alt: string;
}

export function ModelGallery({ images, alt }: ModelGalleryProps) {
  const [active, setActive] = React.useState(0);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);

  const safeActive = Math.min(active, Math.max(0, images.length - 1));
  const current = images[safeActive];

  const next = React.useCallback(() => {
    if (images.length === 0) return;
    setActive((i) => (i + 1) % images.length);
  }, [images.length]);

  const prev = React.useCallback(() => {
    if (images.length === 0) return;
    setActive((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  React.useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxOpen(false);
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, next, prev]);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border bg-muted">
        <span className="caption">Photo coming soon</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="relative block aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted"
        aria-label="Open image gallery"
      >
        {current && (
          <Image
            src={current.url}
            alt={current.caption ?? alt}
            fill
            sizes="(max-width: 1024px) 100vw, 640px"
            className="object-cover"
            priority
          />
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 shadow-sm hover:bg-background"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-2 shadow-sm hover:bg-background"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-medium text-white">
              {safeActive + 1} / {images.length}
            </div>
          </>
        )}
      </button>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              type="button"
              key={img.id}
              onClick={() => setActive(i)}
              aria-label={`Show photo ${i + 1}`}
              className={cn(
                "relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-md border-2 bg-muted transition-opacity",
                i === safeActive ? "border-primary opacity-100" : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <Image src={img.url} alt={img.caption ?? alt} fill sizes="96px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen && current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setLightboxOpen(false)}
            className="absolute right-4 top-4 rounded-full"
            aria-label="Close gallery"
          >
            <X className="h-4 w-4" />
          </Button>
          <div
            className="relative h-full max-h-[85vh] w-full max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={current.url}
              alt={current.caption ?? alt}
              fill
              sizes="100vw"
              className="object-contain"
            />
            {images.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={prev}
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={next}
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </>
            )}
            {current.caption && (
              <p className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-sm text-white">
                {current.caption}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
