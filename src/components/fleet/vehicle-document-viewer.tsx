"use client";

import { Download, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * In-browser viewer for an uploaded vehicle document. Images render with
 * an <img> tag, PDFs with an iframe (browsers' native viewer is plenty
 * for the use case — zoom, scroll, print). Download + new-tab actions
 * are always available in case the embed fails or the user wants a copy.
 */
export function VehicleDocumentViewer({
  open,
  onOpenChange,
  fileUrl,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string | null;
  title: string;
  description?: string;
}) {
  const kind = fileUrl ? guessKind(fileUrl) : "other";

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
            <iframe
              src={fileUrl}
              title={title}
              className="h-full w-full border-0"
            />
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

function guessKind(url: string): "pdf" | "image" | "other" {
  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|gif|avif)$/.test(lower)) return "image";
  return "other";
}
