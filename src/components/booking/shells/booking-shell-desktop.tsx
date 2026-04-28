"use client";

import { WizardProgress } from "@/components/booking/wizard-progress";
import { QuoteSummary } from "@/components/booking/quote-summary";
import { WizardShellLayoutProvider } from "@/components/booking/wizard-shell-layout-context";

/**
 * Desktop + tablet layout for the booking wizard. This is also the
 * fallback layout rendered when `wizard_mobile_shell` is off, so its
 * breakpoint behaviour must remain identical to the pre-refactor page.
 *
 * - `lg:` (≥1024px): two-column grid, steps on the left, sticky quote
 *   summary on the right.
 * - `md:` (768–1023px): single column, summary inline below the step.
 * - `<md`: full-width, summary hidden (hand-off to the mobile shell when
 *   the flag is on).
 */
export function BookingShellDesktop({ children }: { children: React.ReactNode }) {
  return (
    <WizardShellLayoutProvider layout="desktop">
      <div className="container px-0 py-4 md:px-4 md:py-12">
        <WizardProgress />
        <div className="mt-4 grid gap-8 px-3 md:mt-8 md:px-0 lg:grid-cols-[1fr_320px]">
          <div>{children}</div>
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <QuoteSummary />
            </div>
          </aside>
        </div>
      </div>
    </WizardShellLayoutProvider>
  );
}
