"use client";

/**
 * Body components for /dashboard/documents. Each renders the *content* of
 * one identity-related block — the outer card surface and title come from
 * the <PageSection> on the page. Splitting the driver's licence, passport
 * and history into three siblings lets each collapse independently on
 * mobile.
 */

import * as React from "react";
import Image from "next/image";
import { CheckCircle2, Download, Loader2, Upload, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { LicenceDropzonePair } from "@/components/customer/licence-dropzone-pair";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";
import { useDocumentAccessLogger } from "@/hooks/use-document-access-logger";

type DriversLicenceInitial = {
  licenceImageFront: string | null;
  licenceImageBack: string | null;
  licenceExpiry: string | null;
  licenceVerifiedAt: string | null;
};

type PassportInitial = {
  passportImage: string | null;
  passportExpiry: string | null;
  passportVerifiedAt: string | null;
};

type HistoryRow = {
  id: string;
  type: "LICENCE_FRONT" | "LICENCE_BACK" | "PASSPORT";
  fileUrl: string;
  signedUrl: string;
  expiryDate: Date | string | null;
  createdAt: Date | string;
};

const TYPE_LABELS: Record<HistoryRow["type"], string> = {
  LICENCE_FRONT: "Licence (front)",
  LICENCE_BACK: "Licence (back)",
  PASSPORT: "Passport",
};

function formatDate(raw: Date | string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-AU");
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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function DriversLicenceSection({ initial }: { initial: DriversLicenceInitial }) {
  const expiryTone = expiryStatus(initial.licenceExpiry);
  const hasFront = !!initial.licenceImageFront;
  const hasBack = !!initial.licenceImageBack;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <span className="flex items-center gap-1">
          {hasFront ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
          Front
        </span>
        <span className="flex items-center gap-1">
          {hasBack ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
          Back
        </span>
        {initial.licenceVerifiedAt && <StatusBadge status="VERIFIED" />}
        {expiryTone && <StatusBadge status={expiryTone} />}
      </div>

      <LicenceDropzonePair
        profile={{
          licenceImageFront: initial.licenceImageFront,
          licenceImageBack: initial.licenceImageBack,
          licenceExpiry: initial.licenceExpiry,
          licenceVerifiedAt: initial.licenceVerifiedAt,
        }}
      />
    </div>
  );
}

export function PassportSection({ initial }: { initial: PassportInitial }) {
  const util = trpc.useUtils();
  const upload = trpc.customer.uploadIdentityDocument.useMutation();
  const extractPassport = trpc.customer.extractPassportFromImage.useMutation();
  const updateProfile = trpc.customer.updateProfile.useMutation();

  const [uploaded, setUploaded] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const expiryTone = expiryStatus(initial.passportExpiry);
  const has = !!initial.passportImage || uploaded;

  function openPicker() {
    setError(null);
    setToast(null);
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  }

  async function handleFilePicked(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image of the passport bio-data page.");
      return;
    }
    setPhase("uploading");
    setError(null);
    setToast(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/identity-document", { method: "POST", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Upload failed (${res.status})`);
      }
      const { key } = (await res.json()) as { key: string };
      await upload.mutateAsync({ type: "PASSPORT", imageKey: key });
      setUploaded(true);

      try {
        const r = await extractPassport.mutateAsync({ imageKey: key });
        if (r.confidence >= 0.7) {
          const patch: Record<string, string> = {};
          if (r.passportNumber) patch.passportNumber = r.passportNumber;
          if (r.country) patch.passportCountry = r.country;
          if (r.expiryDate) patch.passportExpiry = isoDate(new Date(r.expiryDate));
          if (r.dateOfBirth) patch.dateOfBirth = isoDate(new Date(r.dateOfBirth));
          if (Object.keys(patch).length > 0) {
            try {
              await updateProfile.mutateAsync(
                patch as unknown as Parameters<typeof updateProfile.mutateAsync>[0],
              );
            } catch {
              // non-fatal
            }
          }
        }
      } catch {
        // OCR is non-fatal.
      }

      await util.customer.identityDocuments.invalidate().catch(() => undefined);
      await util.customer.me.invalidate().catch(() => undefined);
      setToast("Passport saved.");
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <span className="flex items-center gap-1">
          {has ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
          Bio-data page
        </span>
        {initial.passportVerifiedAt && (
          <StatusBadge status="VERIFIED" />
        )}
        {expiryTone && <StatusBadge status={expiryTone} />}
      </div>

      {initial.passportImage && (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-muted/40 sm:w-1/2">
          <Image
            src={initial.passportImage}
            alt="Passport bio-data page"
            fill
            sizes="(max-width: 768px) 100vw, 400px"
            className="object-contain"
            unoptimized
          />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
      />

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

      <Button
        size="sm"
        onClick={openPicker}
        disabled={phase === "uploading"}
        className="w-full sm:w-auto"
      >
        {phase === "uploading" ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {has ? "Replace photo of passport" : "Upload photo of passport"}
          </>
        )}
      </Button>
    </div>
  );
}

export function IdentityHistorySection() {
  const { data, isLoading } = trpc.customer.identityDocuments.useQuery();
  const history = (data?.history ?? []) as HistoryRow[];
  const logAccess = useDocumentAccessLogger();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No previous documents on file. When you replace a licence or passport,
        the older one will appear here.
      </p>
    );
  }

  return (
    <DataTable
      data={history}
      getRowId={(row) => row.id}
      columns={[
        {
          id: "type",
          header: "Type",
          cell: (row: HistoryRow) => TYPE_LABELS[row.type],
        },
        {
          id: "uploaded",
          header: "Uploaded",
          cell: (row: HistoryRow) => formatDate(row.createdAt),
        },
        {
          id: "expiry",
          header: "Expires / expired",
          cell: (row: HistoryRow) => formatDate(row.expiryDate),
        },
        {
          id: "file",
          header: "",
          cell: (row: HistoryRow) => (
            <Button asChild size="sm" variant="ghost">
              <a
                href={row.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  logAccess({ documentId: row.id, reason: "download" })
                }
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                Download
              </a>
            </Button>
          ),
        },
      ]}
    />
  );
}
