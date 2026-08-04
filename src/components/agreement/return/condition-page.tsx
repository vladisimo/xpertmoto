"use client";

import { PhotoIssueCapture } from "@/components/agreement/photo-issue-capture";

/**
 * Customer-facing return condition review inside the signing ritual. Read-only:
 * the return photos with any new damage pinned and labelled on them.
 */
export function ReturnConditionPage({ inspectionId }: { inspectionId: string | null }) {
  return (
    <div className="space-y-4">
      <p>
        The vehicle was inspected at return with you present. The photos below show its condition, with any new damage
        pinned and labelled on them. These form part of this return statement and are the basis for any charges.
      </p>
      {inspectionId ? (
        <PhotoIssueCapture inspectionId={inspectionId} readOnly />
      ) : (
        <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          No return inspection is attached.
        </div>
      )}
    </div>
  );
}
