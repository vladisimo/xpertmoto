"use client";

/**
 * Reusable identity-document upload card. Used by:
 *   - Booking wizard Step 4 ("Customer Details")
 *   - /dashboard/profile (customer profile page)
 *   - /dashboard/documents (dedicated documents page)
 *
 * Flow per upload:
 *   1. User picks a file.
 *   2. POST /api/upload/identity-document → { key } (server-only URL; the
 *      client never holds a direct S3 URL for ID documents — see M4 in
 *      docs/security-review notes).
 *   3. trpc.customer.uploadIdentityDocument({ type, imageKey: key }) →
 *      creates CustomerDocument + recomputes profile cache projection.
 *   4. trpc.customer.extract{Licence|Passport}FromImage({ imageKey: key }).
 *   5. When confidence ≥ 0.7:
 *      - If `onExtracted` is supplied (wizard), call it with the patch.
 *      - Otherwise (dashboard surfaces) call customer.updateProfile with
 *        empty-field-only merge and show a toast.
 */

import Image from "next/image";
import * as React from "react";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";

export type IdentityKind = "LICENCE_FRONT" | "LICENCE_BACK" | "PASSPORT";

/** The identity-related fields an `onExtracted` consumer (the wizard)
 *  knows how to merge into its form state. Keys align with the wizard
 *  form and with `customer.updateProfile`. */
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

interface Props {
  kind: IdentityKind;
  /** S3 key or absolute URL of the current (newest-row) image, if any. */
  currentImageUrl: string | null;
  /** Expiry of the current document for the chip. */
  currentExpiry?: Date | string | null;
  /** Staff verification timestamp for the verified badge. */
  currentVerifiedAt?: Date | string | null;
  /**
   * Wizard-mode callback. When supplied, extracted fields are emitted via
   * this callback rather than being written to the profile directly. The
   * wizard uses this to pre-fill its in-progress form without the round-
   * trip to the server.
   */
  onExtracted?: (patch: IdentityExtractedPatch) => void;
  /** Dashboard-mode tweak: shrink card for embedded layouts. */
  compactMode?: boolean;
  /** Optional success hook so callers can refresh queries. */
  onUploaded?: () => void;
}

const LABELS: Record<IdentityKind, string> = {
  LICENCE_FRONT: "Driver's licence — front",
  LICENCE_BACK: "Driver's licence — back",
  PASSPORT: "Passport (bio-data page)",
};

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

// Image columns on CustomerProfile store raw S3 keys (e.g.
// "drivers/u1/file.jpg"). next/image needs a leading "/" or an absolute URL,
// and direct MinIO/S3 URLs fail in dev (unreachable from remote clients) and
// are blocked by CSP in prod. Route bytes through the same-origin
// /api/identity-image proxy, which enforces auth and is CSP-safe.
function resolveImageSrc(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return `/api/identity-image?key=${encodeURIComponent(raw)}`;
}

function expiryStatus(raw: Date | string | null | undefined): "VALID" | "EXPIRES_SOON" | "EXPIRED" | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const diffDays = Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= 60) return "EXPIRES_SOON";
  return "VALID";
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function IdentityUploadCard({
  kind,
  currentImageUrl,
  currentExpiry,
  currentVerifiedAt,
  onExtracted,
  compactMode = false,
  onUploaded,
}: Props) {
  const [file, setFile] = React.useState<File | null>(null);
  const [phase, setPhase] = React.useState<"idle" | "uploading" | "detecting" | "done" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const util = trpc.useUtils();

  const upload = trpc.customer.uploadIdentityDocument.useMutation();
  const extractLicence = trpc.customer.extractLicenceFromImage.useMutation();
  const extractPassport = trpc.customer.extractPassportFromImage.useMutation();
  const updateProfile = trpc.customer.updateProfile.useMutation();

  // Derive the preview URL from the picked file. useMemo avoids the
  // set-state-in-effect pattern; the matching effect below revokes the
  // blob URL when it changes.
  const preview = React.useMemo<string | null>(() => {
    if (!file || !file.type.startsWith("image/")) return null;
    return URL.createObjectURL(file);
  }, [file]);

  React.useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const expiryTone = expiryStatus(currentExpiry);

  function reset() {
    setFile(null);
    setPhase("idle");
    setError(null);
    setToast(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFilePicked(picked: File | null) {
    setPhase("idle");
    setError(null);
    setToast(null);
    setFile(picked);
  }

  async function submit() {
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    setError(null);
    setToast(null);
    setPhase("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/identity-document", { method: "POST", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Upload failed (${res.status})`);
      }
      const json = (await res.json()) as { key: string };

      await upload.mutateAsync({ type: kind, imageKey: json.key });

      // Kick off OCR. Errors here are non-fatal — the document is already
      // on file; we just skip auto-fill.
      setPhase("detecting");
      let patch: IdentityExtractedPatch = {};
      try {
        if (kind === "PASSPORT") {
          const r = await extractPassport.mutateAsync({ imageKey: json.key });
          if (r.confidence >= 0.7) {
            if (r.passportNumber) patch.passportNumber = r.passportNumber;
            if (r.country) patch.passportCountry = r.country;
            if (r.expiryDate) patch.passportExpiry = isoDate(new Date(r.expiryDate));
            if (r.dateOfBirth) patch.dateOfBirth = isoDate(new Date(r.dateOfBirth));
          }
        } else if (kind === "LICENCE_FRONT") {
          const r = await extractLicence.mutateAsync({ imageKey: json.key });
          if (r.confidence >= 0.7) {
            if (r.licenceNumber) patch.licenceNumber = r.licenceNumber;
            if (r.state) patch.licenceState = r.state;
            if (r.licenceClass) patch.licenceClass = r.licenceClass;
            if (r.expiryDate) patch.licenceExpiry = isoDate(new Date(r.expiryDate));
            if (r.dateOfBirth) patch.dateOfBirth = isoDate(new Date(r.dateOfBirth));
          }
        }
      } catch {
        // OCR failure is non-fatal — document is already attached.
      }

      if (Object.keys(patch).length > 0) {
        if (onExtracted) {
          onExtracted(patch);
          setToast("Details detected — review the form above.");
        } else {
          // Dashboard mode: write the OCR patch directly to the profile.
          // `updateProfile` overwrites whatever fields it receives, and emits
          // an audit row carrying both previous and new values for the diff.
          // Cast is needed because licenceState is typed as z.enum on the
          // server; OCR output is a free string and may not match.
          try {
            await updateProfile.mutateAsync(
              patch as unknown as Parameters<typeof updateProfile.mutateAsync>[0],
            );
            setToast("Document saved — details pre-filled from the image.");
          } catch {
            setToast("Document saved. We couldn't auto-fill — please update details manually.");
          }
        }
      } else {
        setToast("Document saved. We couldn't read details from the image — please update them manually.");
      }

      // Refresh the identity-documents query so /dashboard/documents picks
      // up the new row immediately.
      await util.customer.identityDocuments.invalidate().catch(() => undefined);
      await util.customer.me.invalidate().catch(() => undefined);
      onUploaded?.();
      setPhase("done");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  const resolvedCurrentSrc = resolveImageSrc(currentImageUrl);
  const showCurrent = !!resolvedCurrentSrc && phase !== "done";

  return (
    <Card>
      <CardHeader className={compactMode ? "pb-2" : undefined}>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>{LABELS[kind]}</span>
          <div className="flex items-center gap-2">
            {currentVerifiedAt && <StatusBadge status="VERIFIED" />}
            {expiryTone && <StatusBadge status={expiryTone} />}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {showCurrent && (
          <div
            className={
              kind === "PASSPORT"
                ? "relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted/40"
                : "relative aspect-[8/5] w-full overflow-hidden rounded-md border border-border bg-muted/40"
            }
          >
            <Image
              src={resolvedCurrentSrc!}
              alt={LABELS[kind]}
              fill
              sizes="(max-width: 768px) 100vw, 400px"
              className="object-contain"
              unoptimized
            />
          </div>
        )}

        {preview && (
          <div
            className={
              kind === "PASSPORT"
                ? "relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border"
                : "relative aspect-[8/5] w-full overflow-hidden rounded-md border border-border"
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Upload preview" className="h-full w-full object-contain" />
          </div>
        )}

        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
          />
          {file && (
            <p className="text-caption text-muted-foreground">
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {toast && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm text-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{toast}</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={submit}
            disabled={!file || phase === "uploading" || phase === "detecting"}
          >
            {phase === "uploading" ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : phase === "detecting" ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Reading details…
              </>
            ) : (
              <>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {currentImageUrl ? "Replace" : "Upload"}
              </>
            )}
          </Button>
          {(phase === "done" || phase === "error") && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Add another
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
