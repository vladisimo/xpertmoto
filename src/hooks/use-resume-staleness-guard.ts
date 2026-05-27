"use client";
import { useEffect, useRef } from "react";

import { trpc } from "@/lib/trpc/client";
import {
  isPickupTooLate,
  resetStaleBookingWizard,
  useBookingWizard,
} from "@/stores/booking-wizard";

/**
 * One-shot guard that runs when the booking wizard is *resumed* past step 1.
 * Re-checks live availability for the persisted (category, depot, pickup,
 * return) and, if that depot/category is now sold out, wipes the wizard back
 * to step 1 with an "unavailable" notice.
 *
 * The cheaper "pickup time is too late" case is handled synchronously in
 * booking-wizard-client.tsx before this ever fetches, so by the time this
 * runs a time-stale wizard is already gone — we still guard on it here so a
 * clock-skew edge can't trigger a redundant availability round-trip.
 *
 * Fires at most once per mount (ref-gated). Fails open: a network / rate-limit
 * error never resets — the `booking.create` CONFLICT check remains the
 * backstop if a sold-out booking reaches payment.
 */
export function useResumeStalenessGuard(): void {
  const utils = trpc.useUtils();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const s = useBookingWizard.getState();
    // Only a genuine resume past step 1 with the full search committed.
    if (s.step < 2) return;
    if (
      !s.categoryId ||
      !s.pickupDepotId ||
      !s.pickupDateTime ||
      !s.returnDateTime
    ) {
      return;
    }
    // Time-stale wizards are reset synchronously upstream; don't double-fire.
    if (isPickupTooLate(s.pickupDateTime)) return;

    // Snapshot the inputs we're validating so we can confirm the user hasn't
    // moved on by the time the round-trip resolves.
    const snapshot = {
      categoryId: s.categoryId,
      pickupDepotId: s.pickupDepotId,
      pickupDateTime: s.pickupDateTime,
    };

    let cancelled = false;
    void utils.booking.availability
      .fetch({
        categoryId: snapshot.categoryId,
        depotId: snapshot.pickupDepotId,
        pickupDateTime: new Date(snapshot.pickupDateTime),
        returnDateTime: new Date(s.returnDateTime),
      })
      .then((res) => {
        if (cancelled) return;
        // Re-read: the user may have edited or navigated during the fetch.
        const now = useBookingWizard.getState();
        if (now.step < 2) return;
        if (
          now.categoryId !== snapshot.categoryId ||
          now.pickupDepotId !== snapshot.pickupDepotId ||
          now.pickupDateTime !== snapshot.pickupDateTime
        ) {
          return;
        }
        if (res.available <= 0) {
          resetStaleBookingWizard("UNAVAILABLE");
        }
      })
      .catch(() => {
        // Fail open — see doc comment.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
