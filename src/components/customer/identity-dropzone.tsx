"use client";

/**
 * Customer-facing drag-and-drop identity document uploader. Replaces the
 * file-input-button UX in IdentityUploadCard for surfaces that want the
 * dropzone affordance (booking wizard step 4, /dashboard/documents).
 *
 * Flow per upload:
 *   1. User drops/picks a file.
 *   2. POST /api/upload/identity-document → { key } (server-only URL; the
 *      client never holds a direct S3 URL for ID documents).
 *   3. trpc.customer.uploadIdentityDocument({ type, imageKey: key }) →
 *      creates CustomerDocument + recomputes profile cache projection.
 *   4. trpc.customer.extract{Licence|Passport}FromImage({ imageKey: key }).
 *   5. When confidence ≥ 0.7:
 *      - If `onExtracted` is supplied (wizard), call it with the patch.
 *      - Otherwise (dashboard surfaces) call customer.updateProfile (which
 *        upserts the profile row, so missing-profile edge cases self-heal).
 */

import * as React from "react";
import { useDropzone } from "react-dropzone";
import Image from "next/image";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

import { resolveIdentityImageSrc } from "./_identity-image";

export type IdentityKind = "LICENCE_FRONT" | "LICENCE_BACK" | "PASSPORT";

export type IdentityExtractedPatch = Partial<{
  licenceNumber: string;
  licenceState: string;
  licenceExpiry: string;
  licenceClass: string;
  passportNumber: string;
  passportCountry: string;
  passportExpiry: string;
  dateOfBirth: string;
}>;

type OcrStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; confidence?: number; fieldsPopulated: number }
  | { kind: "empty" }
  | { kind: "failed" };

interface Props {
  kind: IdentityKind;
  /** S3 key or absolute URL of the current (newest-row) image, if any. */
  currentImageUrl: string | null;
  /** Expiry of the current document, used for the status chip. */
  currentExpiry?: Date | string | null;
  /** Staff verification timestamp for the verified badge. */
  currentVerifiedAt?: Date | string | null;
  /**
   * Wizard-mode callback. When supplied, extracted fields are emitted via
   * this callback rather than being written to the profile directly.
   */
  onExtracted?: (patch: IdentityExtractedPatch) => void;
  /** Optional success hook so callers can refresh queries. */
  onUploaded?: () => void;
  /** When true, the dropzone is inert (used to gate BACK until FRONT). */
  disabled?: boolean;
  /** Hint rendered when disabled. */
  disabledHint?: string;
}

const LABELS: Record<IdentityKind, string> = {
  LICENCE_FRONT: "Front of driver's licence",
  LICENCE_BACK: "Back of driver's licence",
  PASSPORT: "Passport (bio-data page)",
};

const ACCEPT: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function expiryStatus(
  raw: Date | string | null | undefined,
): "VALID" | "EXPIRES_SOON" | "EXPIRED" | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const diffDays = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= 60) return "EXPIRES_SOON";
  return "VALID";
}

export function IdentityDropzone({
  kind,
  currentImageUrl,
  currentExpiry,
  currentVerifiedAt,
  onExtracted,
  onUploaded,
  disabled = false,
  disabledHint,
}: Props) {
  const util = trpc.useUtils();
  const upload = trpc.customer.uploadIdentityDocument.useMutation();
  const extractLicence = trpc.customer.extractLicenceFromImage.useMutation();
  const extractPassport = trpc.customer.extractPassportFromImage.useMutation();
  const updateProfile = trpc.customer.updateProfile.useMutation();

  const [uploadedKey, setUploadedKey] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "uploading" | "detecting" | "done" | "error">(
    "idle",
  );
  const [ocr, setOcr] = React.useState<OcrStatus>({ kind: "idle" });
  const [error, setError] = React.useState<string | null>(null);
  // Non-error informational notice (e.g. an accepted-but-swapped ID type).
  const [notice, setNotice] = React.useState<string | null>(null);

  const previewSrc = resolveIdentityImageSrc(uploadedKey ?? currentImageUrl);
  const expiryTone = expiryStatus(currentExpiry);
  const hasImage = !!previewSrc;
  const busy = phase === "uploading" || phase === "detecting";

  const handleFile = React.useCallback(
    async (file: File) => {
      setError(null);
      setNotice(null);
      setOcr({ kind: "idle" });
      setPhase("uploading");
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload/identity-document", { method: "POST", body: fd });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Upload failed (${res.status})`);
        }
        const { key } = (await res.json()) as { key: string };

        // The licence back has no extractor — store it as-is.
        if (kind === "LICENCE_BACK") {
          await upload.mutateAsync({ type: kind, imageKey: key });
          setUploadedKey(key);
          setPhase("done");
        } else {
          // Classify + read details BEFORE storing so a genuine non-ID image
          // is rejected without creating a CustomerDocument row. A swapped ID
          // type is accepted (both are valid IDs) but not pre-filled — the
          // extractor returns no cross-type fields.
          setPhase("detecting");
          setOcr({ kind: "running" });
          const patch: IdentityExtractedPatch = {};
          let detected: "DRIVERS_LICENCE" | "PASSPORT" | "OTHER" | undefined;
          let confidence: number | undefined;
          let nudge: string | null = null;
          try {
            if (kind === "PASSPORT") {
              const r = await extractPassport.mutateAsync({ imageKey: key });
              detected = r.documentType;
              confidence = r.confidence;
              if (r.documentType !== "OTHER" && r.confidence >= 0.7) {
                if (r.passportNumber) patch.passportNumber = r.passportNumber;
                if (r.country) patch.passportCountry = r.country;
                if (r.expiryDate) patch.passportExpiry = isoDate(new Date(r.expiryDate));
                if (r.dateOfBirth) patch.dateOfBirth = isoDate(new Date(r.dateOfBirth));
              }
              if (r.documentType === "DRIVERS_LICENCE") {
                nudge =
                  "This looks like a driver's licence — we've saved it here, but you'll still need to upload your passport.";
              }
            } else {
              // LICENCE_FRONT
              const r = await extractLicence.mutateAsync({ imageKey: key });
              detected = r.documentType;
              confidence = r.confidence;
              if (r.documentType !== "OTHER" && r.confidence >= 0.7) {
                if (r.licenceNumber) patch.licenceNumber = r.licenceNumber;
                if (r.state) patch.licenceState = r.state;
                if (r.licenceClass) patch.licenceClass = r.licenceClass;
                if (r.expiryDate) patch.licenceExpiry = isoDate(new Date(r.expiryDate));
                if (r.dateOfBirth) patch.dateOfBirth = isoDate(new Date(r.dateOfBirth));
              }
              if (r.documentType === "PASSPORT") {
                nudge =
                  "This looks like a passport — we've saved it here, but you'll still need to upload your driver's licence.";
              }
            }
          } catch {
            // OCR/classification failure is non-fatal — fall through and store
            // without pre-fill. Only a definitive OTHER blocks the upload.
            detected = undefined;
            setOcr({ kind: "failed" });
          }

          // Reject a genuine non-ID image — do not store it.
          if (detected === "OTHER") {
            setPhase("error");
            setOcr({ kind: "idle" });
            setError(
              kind === "PASSPORT"
                ? "This doesn't look like a passport. Please upload a clear photo of your passport's photo page."
                : "This doesn't look like a driver's licence. Please upload a clear photo of your licence.",
            );
            return;
          }

          await upload.mutateAsync({ type: kind, imageKey: key });
          setUploadedKey(key);
          if (nudge) setNotice(nudge);

          // Leave a "failed" status as-is; otherwise reflect the extraction.
          setOcr((prev) =>
            prev.kind === "failed"
              ? prev
              : Object.keys(patch).length > 0
                ? {
                    kind: "done",
                    ...(confidence != null ? { confidence } : {}),
                    fieldsPopulated: Object.keys(patch).length,
                  }
                : { kind: "empty" },
          );

          if (Object.keys(patch).length > 0) {
            if (onExtracted) {
              onExtracted(patch);
            } else {
              try {
                await updateProfile.mutateAsync(
                  patch as unknown as Parameters<typeof updateProfile.mutateAsync>[0],
                );
              } catch {
                // Non-fatal — image is on file; staff or user can fill manually.
              }
            }
          }
          setPhase("done");
        }

        await util.customer.identityDocuments.invalidate().catch(() => undefined);
        await util.customer.me.invalidate().catch(() => undefined);
        onUploaded?.();
      } catch (e) {
        setPhase("error");
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    },
    [kind, onExtracted, onUploaded, upload, extractLicence, extractPassport, updateProfile, util],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT,
    multiple: false,
    disabled: disabled || busy,
    maxSize: 16 * 1024 * 1024,
    onDrop: (files) => {
      const f = files[0];
      if (f) void handleFile(f);
    },
  });

  function clearLocalPreview() {
    setUploadedKey(null);
    setPhase("idle");
    setOcr({ kind: "idle" });
    setError(null);
    setNotice(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{LABELS[kind]}</span>
        <div className="flex items-center gap-1.5">
          {currentVerifiedAt && <StatusBadge status="VERIFIED" />}
          {expiryTone && <StatusBadge status={expiryTone} />}
          <OcrStatusChip status={ocr} />
        </div>
      </div>

      {hasImage ? (
        <FilePreview
          src={previewSrc!}
          aspect={kind === "PASSPORT" ? "aspect-[4/3]" : "aspect-[8/5]"}
          onReplace={disabled ? undefined : clearLocalPreview}
        />
      ) : (
        <div
          {...getRootProps()}
          aria-disabled={disabled}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors",
            kind === "PASSPORT" ? "aspect-[4/3]" : "aspect-[8/5]",
            disabled
              ? "cursor-not-allowed border-input bg-muted/20 opacity-60"
              : isDragActive
                ? "border-primary bg-primary/5"
                : "border-input bg-muted/30 hover:bg-muted/60",
            busy && "pointer-events-none",
          )}
        >
          <input {...getInputProps()} />
          {busy ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {phase === "uploading" ? "Uploading…" : "Reading details…"}
              </span>
            </>
          ) : disabled ? (
            <>
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{disabledHint ?? "Locked"}</span>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {isDragActive ? "Drop to upload" : "Drag & drop, or click to pick"}
              </span>
              <span className="text-caption text-muted-foreground">JPG, PNG, WebP · max 16 MB</span>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {notice && !error && (
        <p className="text-sm text-muted-foreground">{notice}</p>
      )}
    </div>
  );
}

function OcrStatusChip({ status }: { status: OcrStatus }) {
  if (status.kind === "idle") return null;
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium";
  if (status.kind === "running") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Reading…
      </span>
    );
  }
  if (status.kind === "done") {
    const pct = status.confidence != null ? Math.round(status.confidence * 100) : null;
    return (
      <span className={cn(base, "bg-primary/10 text-primary")}>
        <CheckCircle2 className="h-3 w-3" />
        Detected{pct != null ? ` · ${pct}%` : ""}
      </span>
    );
  }
  if (status.kind === "empty") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>No text found</span>
    );
  }
  return (
    <span className={cn(base, "bg-destructive/10 text-destructive")}>
      <AlertTriangle className="h-3 w-3" />
      Detection failed
    </span>
  );
}

function FilePreview({
  src,
  aspect,
  onReplace,
}: {
  src: string;
  aspect: string;
  onReplace?: () => void;
}) {
  const isImage = !src.toLowerCase().endsWith(".pdf");
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-md border border-border bg-muted/30",
        aspect,
      )}
    >
      {isImage ? (
        <Image
          src={src}
          alt="Identity document"
          fill
          sizes="(max-width: 768px) 100vw, 400px"
          className="object-contain"
          unoptimized
        />
      ) : (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-full w-full items-center justify-center gap-2 p-4 text-sm text-primary underline"
        >
          <FileText className="h-4 w-4" />
          View uploaded file
        </a>
      )}
      {onReplace && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onReplace}
          className="absolute right-1 top-1 h-7 w-7 bg-background/80 hover:bg-background"
          aria-label="Replace file"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
