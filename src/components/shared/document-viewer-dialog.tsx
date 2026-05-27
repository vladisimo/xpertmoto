"use client";

import * as React from "react";
import { Download, ExternalLink } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Centred in-page viewer for a single document. PDFs render in the
 * browser's native <iframe> viewer (zoom, scroll, print all work),
 * images render with an <img>, anything else falls back to a download
 * link. New-tab + Download actions live in the header so the user can
 * always grab a copy or pop out if the embed fails.
 *
 * This is the canonical PDF/document viewer for the back-office. Trigger
 * it directly (controlled) or via <DocumentViewerButton> for the common
 * one-link-opens-one-document case.
 */
export function DocumentViewerDialog({
  open,
  onOpenChange,
  fileUrl,
  title,
  description,
  kind: kindProp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string | null;
  title: string;
  description?: string;
  /**
   * Force the render mode. Needed when `fileUrl` is an API route with no
   * file extension (e.g. `/api/bookings/{id}/rental-agreement`) — without
   * this we'd sniff "other" and show the download fallback. Defaults to
   * sniffing the extension off the URL.
   */
  kind?: "pdf" | "image" | "other";
}) {
  const kind = kindProp ?? (fileUrl ? guessKind(fileUrl) : "other");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate">{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
            {fileUrl && (
              <div className="flex items-center gap-2 shrink-0">
                <Button asChild variant="secondary" size="sm">
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1 h-4 w-4" /> New tab
                  </a>
                </Button>
                <Button asChild size="sm">
                  <a href={fileUrl} download>
                    <Download className="mr-1 h-4 w-4" /> Download
                  </a>
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-muted/30">
          {!fileUrl ? (
            <EmptyState />
          ) : kind === "pdf" ? (
            <iframe src={fileUrl} title={title} className="h-full w-full border-0" />
          ) : kind === "image" ? (
            <div className="h-full w-full overflow-auto flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl} alt={title} className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <UnsupportedState href={fileUrl} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Self-contained trigger: a button that opens a <DocumentViewerDialog>
 * for `fileUrl`. Keeps every call site to a one-liner. Button styling and
 * label pass through (`variant`, `size`, `className`, `children`).
 */
export function DocumentViewerButton({
  fileUrl,
  title,
  description,
  kind,
  children,
  ...buttonProps
}: {
  fileUrl: string | null;
  title: string;
  description?: string;
  kind?: "pdf" | "image" | "other";
} & Omit<ButtonProps, "asChild" | "onClick">) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} {...buttonProps}>
        {children}
      </Button>
      <DocumentViewerDialog
        open={open}
        onOpenChange={setOpen}
        fileUrl={fileUrl}
        title={title}
        description={description}
        kind={kind}
      />
    </>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      No file to preview.
    </div>
  );
}

function UnsupportedState({ href }: { href: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <p>This file type can&apos;t be previewed in-browser.</p>
      <Button asChild>
        <a href={href} download>
          <Download className="mr-1 h-4 w-4" /> Download file
        </a>
      </Button>
    </div>
  );
}

export function guessKind(url: string): "pdf" | "image" | "other" {
  // Strip query string and hash before sniffing the extension so signed
  // URLs (?X-Amz-…) and PDF view fragments (#view=FitH) don't fool us.
  const lower = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|gif|avif)$/.test(lower)) return "image";
  return "other";
}
