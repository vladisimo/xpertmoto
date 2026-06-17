"use client";

import * as React from "react";
import Image from "next/image";
import { Loader2, Upload, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 16 * 1024 * 1024;

/** Fields the OCR can pre-fill on the onboarding identity step. Country codes
 *  are intentionally omitted — the extractor returns a country *name*, which
 *  doesn't fit the 2-letter-code inputs the wizard uses. */
export type OnboardingExtractedPatch = Partial<{
  licenceNumber: string;
  licenceState: string;
  licenceExpiry: string;
  licenceClass: string;
  passportNumber: string;
  passportExpiry: string;
}>;

function toIsoDate(d: Date | string | undefined): string | undefined {
  if (!d) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export interface IdentityDocUploaderProps {
  label: string;
  description?: string;
  /** S3 key of the uploaded document, if any. */
  imageKey: string | null;
  onChange: (key: string | null) => void;
  /**
   * Which extractor to run after upload, so the image can be classified:
   * "LICENCE_FRONT" (driver's licence or international permit) or "PASSPORT".
   * Omit for slots that shouldn't be classified (e.g. the licence back).
   */
  kind?: "LICENCE_FRONT" | "PASSPORT";
  /** Pre-fill callback fired when a matching, confidently-read document is
   *  classified. Caller maps the patch onto its form. */
  onExtracted?: (patch: OnboardingExtractedPatch) => void;
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
  kind,
  onExtracted,
  required,
  className,
}: IdentityDocUploaderProps) {
  const [pending, setPending] = React.useState(false);
  const [detecting, setDetecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Non-error informational notice (e.g. an accepted-but-swapped ID type).
  const [notice, setNotice] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const extractLicence = trpc.onboarding.extractLicenceFromImage.useMutation();
  const extractPassport = trpc.onboarding.extractPassportFromImage.useMutation();

  async function handleFile(file: File) {
    setError(null);
    setNotice(null);
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
      const key = data.key;

      // Slots without an expected type (e.g. the licence back) are stored as-is.
      if (!kind) {
        onChange(key);
        return;
      }

      // Classify before accepting: reject a genuine non-ID outright; accept the
      // other valid ID type with a nudge (no cross-type pre-fill); pre-fill the
      // typed fields on a confident match.
      setDetecting(true);
      try {
        if (kind === "PASSPORT") {
          const r = await extractPassport.mutateAsync({ imageKey: key });
          if (r.documentType === "OTHER") {
            setError(
              "This doesn't look like a passport. Please upload a clear photo of your passport's photo page.",
            );
            return;
          }
          onChange(key);
          if (r.documentType === "DRIVERS_LICENCE") {
            setNotice(
              "This looks like a driver's licence — saved, but the passport slot still needs your passport.",
            );
          } else if (r.confidence >= 0.7) {
            onExtracted?.({
              ...(r.passportNumber ? { passportNumber: r.passportNumber } : {}),
              ...(toIsoDate(r.expiryDate) ? { passportExpiry: toIsoDate(r.expiryDate)! } : {}),
            });
          }
        } else {
          // LICENCE_FRONT — covers an AU licence and an international permit.
          const r = await extractLicence.mutateAsync({ imageKey: key });
          if (r.documentType === "OTHER") {
            setError(
              "This doesn't look like a driver's licence or permit. Please upload a clear photo of the document.",
            );
            return;
          }
          onChange(key);
          if (r.documentType === "PASSPORT") {
            setNotice(
              "This looks like a passport — saved, but this slot needs your driver's licence or permit.",
            );
          } else if (r.confidence >= 0.7) {
            onExtracted?.({
              ...(r.licenceNumber ? { licenceNumber: r.licenceNumber } : {}),
              ...(r.state ? { licenceState: r.state } : {}),
              ...(toIsoDate(r.expiryDate) ? { licenceExpiry: toIsoDate(r.expiryDate)! } : {}),
              ...(r.licenceClass ? { licenceClass: r.licenceClass } : {}),
            });
          }
        }
      } catch {
        // OCR/classification failure is non-fatal — accept the upload, no
        // pre-fill. Only a definitive OTHER classification blocks the upload.
        onChange(key);
      } finally {
        setDetecting(false);
      }
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
            onClick={() => {
              onChange(null);
              setNotice(null);
              setError(null);
            }}
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
          <span>
            {pending
              ? detecting
                ? "Checking document…"
                : "Uploading…"
              : "Tap to upload a photo or PDF"}
          </span>
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
      {notice && !error ? (
        <p className="caption text-muted-foreground">{notice}</p>
      ) : null}
    </div>
  );
}
