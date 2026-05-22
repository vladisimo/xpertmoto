"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useBookingWizard } from "@/stores/booking-wizard";
import { WizardShellLayoutProvider } from "@/components/booking/wizard-shell-layout-context";
import { bookingStepLabel, STEPS } from "@/components/booking/wizard-progress";
import { BookingMobileBottomBar } from "./booking-mobile-bottom-bar";
import { BookingMobileSummarySheet } from "./booking-mobile-summary-sheet";

/**
 * Full-screen mobile wizard shell. The wizard steps themselves keep
 * rendering their inline Back/Continue buttons; the sticky bottom bar
 * here is for summary access + price visibility, not the primary CTA
 * (that refactor is scoped into a follow-up).
 *
 * Layout: `flex flex-col min-h-[100svh]` so the sticky footer sits at the
 * bottom of the viewport (100svh not 100vh so it accounts for dynamic
 * mobile UI chrome). The header uses a small, familiar chevron-back +
 * step counter instead of the full <WizardProgress> pill row, which
 * isn't ergonomic on narrow screens — the compact progress indicator
 * lives underneath with a thin track.
 */
export function BookingShellMobile({ children }: { children: React.ReactNode }) {
  const step = useBookingWizard((s) => s.step);
  const back = useBookingWizard((s) => s.back);
  const [summaryOpen, setSummaryOpen] = useState(false);

  return (
    <WizardShellLayoutProvider layout="mobile">
      <div className="flex min-h-[100svh] flex-col bg-background">
      <header className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 flex items-center justify-between border-b border-border bg-muted/95 px-3 py-2 backdrop-blur">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => back()}
            aria-label="Back to previous step"
            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <Link
            href="/"
            aria-label="Back to home"
            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
        )}
        <span className="caption truncate text-center text-muted-foreground">
          Step {step} of {STEPS.length}
          {bookingStepLabel(step) && (
            <span className="ml-1 text-foreground">: {bookingStepLabel(step)}</span>
          )}
        </span>
        <div className="w-10" aria-hidden />
      </header>

      <main className="flex-1 px-3 pb-6 pt-2">{children}</main>

      <BookingMobileBottomBar onOpenSummary={() => setSummaryOpen(true)} />
      <BookingMobileSummarySheet open={summaryOpen} onOpenChange={setSummaryOpen} />
      </div>
    </WizardShellLayoutProvider>
  );
}
