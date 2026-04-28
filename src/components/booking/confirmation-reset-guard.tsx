"use client";

import { useEffect } from "react";
import { flushBookingWizard } from "@/stores/booking-wizard";

/**
 * Belt-and-braces reset for the booking confirmation page.
 *
 * `step-payment.tsx` already calls `flushBookingWizard()` on success before
 * navigating here, so on the happy path this component is a no-op. It
 * still runs because:
 * - a hard refresh on the confirmation URL restarts the client with a
 *   re-hydrated wizard store from localStorage,
 * - a back/forward navigation after completion can land here with stale
 *   state,
 * - a shared confirmation link opened by a customer mid-wizard would
 *   otherwise leak their stale booking into the shared recipient's tab.
 *
 * Runs exactly once on mount.
 */
export function ConfirmationResetGuard(): null {
  useEffect(() => {
    flushBookingWizard();
  }, []);
  return null;
}
