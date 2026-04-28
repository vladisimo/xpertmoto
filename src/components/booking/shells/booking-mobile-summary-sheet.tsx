"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { QuoteSummary } from "@/components/booking/quote-summary";

/**
 * Bottom-anchored drawer that wraps the full <QuoteSummary>. Opened from
 * the mobile bottom bar's price chip. `open` and `onOpenChange` are
 * controlled by the parent shell so the chip can both open and close it.
 */
export function BookingMobileSummarySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-lg pb-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        <SheetHeader>
          <SheetTitle>Your quote</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <QuoteSummary nested />
        </div>
      </SheetContent>
    </Sheet>
  );
}
