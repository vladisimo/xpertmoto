"use client";

import * as React from "react";
import { useDropzone } from "react-dropzone";
import { Loader2, Upload, FileText, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type UploadResult = { url: string; key: string };

export type OcrStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; confidence?: number; fieldsPopulated: number }
  | { kind: "empty" }
  | { kind: "failed"; message?: string };

export type IdDropZoneProps = {
  /** Label shown above the zone — e.g. "Passport", "Licence — front". */
  label: string;
  /** Optional helper text shown under the label. */
  hint?: string;
  /** Current URL of the uploaded file (the parent owns state). */
  value: string;
  onChange: (url: string) => void;
  /** Fired once an upload completes — used to kick off detection. */
  onUploaded?: (result: UploadResult) => void;
  /** Controlled OCR status pushed in by the parent. */
  ocrStatus?: OcrStatus;
  /** MIME types accepted. Defaults to images + PDF. */
  accept?: string;
};

async function uploadToServer(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload/customer-document", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadResult;
}

/**
 * Drag-and-drop file zone used for identity documents in the staff new-
 * customer wizard. Wraps `react-dropzone`, uploads via the existing
 * `/api/upload/customer-document` endpoint, and surfaces an OCR status
 * chip so the parent step can drive Claude-vision extraction.
 */
export function IdDropZone({
  label,
  hint,
  value,
  onChange,
  onUploaded,
  ocrStatus,
  accept = "image/*,application/pdf",
}: IdDropZoneProps) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleFile = React.useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const result = await uploadToServer(file);
        onChange(result.url);
        onUploaded?.(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onChange, onUploaded],
  );

  const acceptMap = React.useMemo(() => {
    // react-dropzone wants { "mime/type": [".ext"] } — derive a loose one
    // from the CSV string we accept as prop.
    const out: Record<string, string[]> = {};
    for (const entry of accept.split(",").map((s) => s.trim())) {
      if (!entry) continue;
      out[entry] = [];
    }
    return out;
  }, [accept]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: acceptMap,
    multiple: false,
    disabled: uploading,
    onDrop: (files) => {
      const f = files[0];
      if (f) void handleFile(f);
    },
  });

  const hasFile = value.length > 0;

  return (
    <div className="space-y-2">
      {(label || ocrStatus) && (
        <div className="flex items-baseline justify-between">
          {label ? <span className="text-sm font-medium">{label}</span> : <span />}
          {ocrStatus && <OcrStatusChip status={ocrStatus} />}
        </div>
      )}
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}

      {hasFile ? (
        <FilePreview url={value} onRemove={() => onChange("")} />
      ) : (
        <div
          {...getRootProps()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-input bg-muted/30 hover:bg-muted/60",
            uploading && "pointer-events-none opacity-80",
          )}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {isDragActive ? "Drop to upload" : "Drag & drop, or click to pick"}
              </span>
              <span className="text-caption text-muted-foreground">
                PDF, JPG, PNG · max 16 MB
              </span>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
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
        Detected
        {pct != null ? ` · ${pct}%` : ""}
      </span>
    );
  }
  if (status.kind === "empty") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        No text found
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-destructive/10 text-destructive")}>
      <AlertTriangle className="h-3 w-3" />
      {status.message ?? "Detection failed"}
    </span>
  );
}

function FilePreview({ url, onRemove }: { url: string; onRemove: () => void }) {
  const isImage = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
  return (
    <div className="relative overflow-hidden rounded-md border bg-muted/30">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Uploaded" className="h-40 w-full object-contain" />
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-4 text-sm text-primary underline"
        >
          <FileText className="h-4 w-4" />
          View uploaded file
        </a>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="absolute right-1 top-1 h-7 w-7 bg-background/80 hover:bg-background"
        aria-label="Remove file"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
