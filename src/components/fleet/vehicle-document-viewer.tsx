"use client";

import { DocumentViewerDialog } from "@/components/shared/document-viewer-dialog";

/**
 * In-browser viewer for an uploaded vehicle document. Thin wrapper around
 * the shared {@link DocumentViewerDialog} — preserved as a named export so
 * existing fleet call sites stay unchanged.
 */
export function VehicleDocumentViewer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string | null;
  title: string;
  description?: string;
}) {
  return <DocumentViewerDialog {...props} />;
}
