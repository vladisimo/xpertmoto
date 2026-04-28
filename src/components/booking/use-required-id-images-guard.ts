"use client";

import { useMemo } from "react";

import { useBookingWizard } from "@/stores/booking-wizard";
import { trpc } from "@/lib/trpc/client";
import { useBookingFlags } from "@/components/booking/booking-flags-context";

export type MissingIdImageKind = "LICENCE" | "PASSPORT";

/**
 * Single source of truth for the wizard's "you must upload your ID photos
 * before continuing" gate. Used at step 4 (Details) where images are
 * uploaded, and at steps 5 (Review) and 6 (Payment) as a safety net so a
 * customer who lands deep-linked or via back/forward can't proceed without
 * their photos. The `goBackToDetails()` callback returns to step 4 so the
 * upload UI is reachable.
 *
 * Gate is only active when the `wizard_intl_licence_flow` flag is on; the
 * legacy "any one valid ID" path keeps its existing behaviour.
 */
export function useRequiredIdImagesGuard() {
  const w = useBookingWizard();
  const flags = useBookingFlags();
  const { data: me, isSuccess: meLoaded } = trpc.customer.me.useQuery(undefined, {
    staleTime: 60_000,
  });
  const profile = me?.customerProfile;

  const missingImageKinds = useMemo<MissingIdImageKind[]>(() => {
    if (!flags.wizard_intl_licence_flow) return [];
    const profilePath =
      profile?.licenceType === "AU_LICENCE" || profile?.licenceType === "INTERNATIONAL"
        ? profile.licenceType
        : null;
    const path = w.identityPath ?? profilePath;
    if (!path) return [];
    const missing: MissingIdImageKind[] = [];
    if (!profile?.licenceImageFront) missing.push("LICENCE");
    if (path === "INTERNATIONAL" && !profile?.passportImage) missing.push("PASSPORT");
    return missing;
  }, [
    flags.wizard_intl_licence_flow,
    w.identityPath,
    profile?.licenceType,
    profile?.licenceImageFront,
    profile?.passportImage,
  ]);

  const missingImagesMessage = useMemo<string | null>(() => {
    if (missingImageKinds.length === 0) return null;
    if (missingImageKinds.length === 1) {
      return missingImageKinds[0] === "LICENCE"
        ? "Please upload a photo of your driver's licence to continue."
        : "Please upload a photo of your passport to continue.";
    }
    return "Please upload photos of your driver's licence and passport to continue.";
  }, [missingImageKinds]);

  function goBackToDetails() {
    w.setStep(4);
  }

  // True once the customer profile has resolved at least once. Callers
  // that take destructive actions (e.g. firing createBooking) should wait
  // for this before treating `missingImagesMessage === null` as authoritative
  // — otherwise they may act on a stale "no missing images" reading
  // produced while the profile is still loading.
  return { missingImageKinds, missingImagesMessage, goBackToDetails, idGateReady: meLoaded };
}
