"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CapturedPhoto = {
  id: string;
  url: string;
  caption?: string;
};

export type PhotoCaptureGridProps = {
  /** Upload endpoint. Receives FormData with key `file` and `caption`. Returns {url}. */
  uploadUrl: string;
  /** Extra form fields to include with each upload (e.g. inspectionId). */
  extraFields?: Record<string, string>;
  /** Suggested slot labels. Empty = free-form; any number of photos allowed. */
  slots?: string[];
  /** Already-captured photos shown pre-filled. */
  initial?: CapturedPhoto[];
  /** Called after a new photo successfully uploads. */
  onUploaded: (photo: CapturedPhoto) => void;
  /** Called after a photo is removed. */
  onRemoved?: (id: string) => void;
  className?: string;
};

const DEFAULT_SLOTS = ["Front", "Rear", "Left side", "Right side", "Odometer", "Tank / fuel"];

/**
 * Grid of photo slots. Tapping a slot opens the tablet camera via a
 * hidden file input. Photos are compressed client-side to ≤1600px at
 * JPEG q=0.82 before upload.
 */
export function PhotoCaptureGrid({
  uploadUrl,
  extraFields,
  slots = DEFAULT_SLOTS,
  initial,
  onUploaded,
  onRemoved,
  className,
}: PhotoCaptureGridProps) {
  const [photos, setPhotos] = useState<CapturedPhoto[]>(initial ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeCaptionRef = useRef<string | null>(null);

  const openCamera = (caption: string) => {
    activeCaptionRef.current = caption;
    inputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const caption = activeCaptionRef.current ?? undefined;
    setBusy(caption ?? "unnamed");

    const compressed = await compress(file);
    const form = new FormData();
    form.append("file", compressed, file.name);
    if (caption) form.append("caption", caption);
    for (const [k, v] of Object.entries(extraFields ?? {})) form.append(k, v);

    try {
      const res = await fetch(uploadUrl, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { id: string; url: string };
      const photo: CapturedPhoto = { id: data.id, url: data.url, caption };
      setPhotos((prev) => [...prev, photo]);
      onUploaded(photo);
    } catch (err) {
      console.error("photo upload failed", err);
      alert("Photo upload failed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    onRemoved?.(id);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {slots.map((slot) => {
          const existing = photos.find((p) => p.caption === slot);
          const isBusy = busy === slot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => openCamera(slot)}
              disabled={isBusy}
              className={cn(
                "relative aspect-[4/3] w-full overflow-hidden rounded-md border-2 border-dashed border-input bg-muted/40 text-left text-xs font-medium text-muted-foreground transition",
                existing ? "border-solid border-primary/40" : "hover:bg-muted",
              )}
            >
              {existing ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={existing.url} alt={slot} className="h-full w-full object-contain" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                    {slot}
                  </span>
                </>
              ) : (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
                  <span className="text-2xl leading-none">{isBusy ? "…" : "+"}</span>
                  <span>{slot}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {photos.filter((p) => !slots.includes(p.caption ?? "")).length > 0 && (
        <div className="space-y-2">
          <div className="eyebrow">Extras</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos
              .filter((p) => !slots.includes(p.caption ?? ""))
              .map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-md border border-input">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption ?? "extra"} className="h-full w-full object-contain" />
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="absolute right-1 top-1 h-6 w-6 p-0"
                    onClick={() => removePhoto(p.id)}
                  >
                    ×
                  </Button>
                </div>
              ))}
          </div>
        </div>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={() => openCamera("extra")}>
        Add extra photo
      </Button>
    </div>
  );
}

async function compress(file: File, maxEdge = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality);
    });
  } catch {
    return file;
  }
}
