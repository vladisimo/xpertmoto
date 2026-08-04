"use client";

import { PhotoIssueCapture } from "@/components/agreement/photo-issue-capture";

/**
 * Customer-facing pre-hire condition review inside the signing ritual. Shows the
 * photos staff captured and the issues they pinned on them (read-only), and lets
 * the customer flag their own pre-existing damage by tapping a photo. The
 * customer can only edit/remove their own additions, never staff records.
 */
export function ConditionPage({ inspectionId, categoryId }: { inspectionId: string | null; categoryId?: string }) {
  if (!inspectionId) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        No pre-hire inspection is attached to this booking.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p>
        Please review the vehicle condition with the staff member. The photos below and the issues pinned on them were
        captured at handover and form part of this agreement — they are the reference used at return to assess any new
        damage. If you spot pre-existing damage the staff member missed, tap the photo to add your own note.
      </p>
      <PhotoIssueCapture
        inspectionId={inspectionId}
        categoryId={categoryId}
        source="customer"
        allowCapture={false}
        allowTariff={false}
        editableSource="customer"
      />
      <div className="rounded-md bg-muted/40 p-3 text-sm">
        I&apos;ve reviewed the condition report and the vehicle&apos;s condition matches the record above. I understand
        that any new damage identified at return will be assessed against this baseline.
      </div>
    </div>
  );
}
