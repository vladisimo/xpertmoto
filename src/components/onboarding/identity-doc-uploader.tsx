"use client";

import * as React from "react";
import Image from "next/image";
import { Loader2, Upload, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 16 * 1024 * 1024;

export interface IdentityDocUploaderProps {
  label: string;
  description?: string;
  /** S3 key of the uploaded document, if any. */
  imageKey: string | null;
  onChange: (key: string | null) => void;
  /** Mark the field as required for visual / a11y purposes. */
  required?: boolean;
  className?: string;
}

/**
 * Minimal identity-document uploader for the onboarding wizard. Posts to
 * `/api/upload/identity-document` (auth-only, NOT requiresOnboarding-
 * gated) and stores the returned S3 key. Used during onboarding before
 * `customer.uploadIdentityDocument` (which is requiresOnboarding-gated)
 * would be allowed — the equivalent CustomerDocument rows are created at
 * `onboarding.complete` time via the metadata captured here, but for the
 * licence/passport image columns on CustomerProfile we just persist the
 * key directly via `onboarding.updateProfile`.
 */
export function IdentityDocUploader({
  label,
  description,
  imageKey,
  onChange,
  required,
  className,
}: IdentityDocUploaderProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type) {
      setError("Couldn't read that file — try another.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File is too large. Maximum 16 MB.");
      return;
    }
    setPending(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/identity-document", {
        method: "POST",
        body: fd,
      });
      const data: { key?: string; error?: string } = await res.json();
      if (!res.ok || !data.key) {
        setError(data.error ?? "Upload failed. Please try again.");
        return;
      }
      onChange(data.key);
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </span>
        {imageKey ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            disabled={pending}
            className="text-muted-foreground"
          >
            <XCircle className="mr-1 h-4 w-4" /> Remove
          </Button>
        ) : null}
      </div>
      {description ? (
        <p className="caption text-muted-foreground">{description}</p>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      {imageKey ? (
        <div className="overflow-hidden rounded-md border border-border bg-muted/40">
          <div className="relative aspect-[5/3] w-full bg-muted">
            <Image
              src={`/api/identity-image?key=${encodeURIComponent(imageKey)}`}
              alt="Uploaded document"
              fill
              sizes="(max-width: 640px) 100vw, 640px"
              className="object-contain"
              unoptimized
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={pending}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-sm",
            "hover:bg-muted/40",
            pending && "opacity-60",
          )}
        >
          {pending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Upload className="h-5 w-5" />
          )}
          <span>{pending ? "Uploading…" : "Tap to upload a photo or PDF"}</span>
          <span className="caption text-muted-foreground">
            JPEG, PNG, WebP, or PDF · up to 16 MB
          </span>
        </button>
      )}
      {error ? (
        <p className="caption text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
