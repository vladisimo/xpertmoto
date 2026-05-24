"use client";
import { SessionProvider } from "next-auth/react";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  POST_BOOKING_RESET_FLAG,
  isPickupTooLate,
  maxReachableStep,
  resetStaleBookingWizard,
  useBookingWizard,
  type WizardStep,
} from "@/stores/booking-wizard";
import { useResumeStalenessGuard } from "@/hooks/use-resume-staleness-guard";
import { StepSearch } from "@/components/booking/step-search";
import { StepVehicle } from "@/components/booking/step-vehicle";
import { StepExtras } from "@/components/booking/step-extras";
import { StepDetails } from "@/components/booking/step-details";
import { StepReview } from "@/components/booking/step-review";
import { StepPayment } from "@/components/booking/step-payment";
import { LoadingBlock } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { BookingShellDesktop } from "@/components/booking/shells/booking-shell-desktop";
import { BookingShellMobile } from "@/components/booking/shells/booking-shell-mobile";
import {
  BookingFlagsProvider,
  type BookingFlags,
} from "@/components/booking/booking-flags-context";

function BookingWizardInner({ flags }: { flags: BookingFlags }) {
  const step = useBookingWizard((s) => s.step);
  const w = useBookingWizard();
  const params = useSearchParams();
  const isMobile = useIsMobile();

  // Re-validate availability on resume past step 1; resets the wizard if the
  // chosen depot/category has sold out since the customer left.
  useResumeStalenessGuard();

  useEffect(() => {
    // The post-payment redirect lands on /booking/confirmation, which sets
    // this flag. If the user then navigates back to /booking (via link or
    // browser back), skip one round of URL-param seeding so a stale share
    // link can't rehydrate the just-cleared store. Legitimate entry points
    // (homepage widget, /fleet CTAs) arrive without the flag and seed
    // normally.
    if (typeof window !== "undefined") {
      try {
        if (sessionStorage.getItem(POST_BOOKING_RESET_FLAG)) {
          sessionStorage.removeItem(POST_BOOKING_RESET_FLAG);
          // Belt-and-braces: even though `flushBookingWizard()` already
          // ran on the confirmation page, clear in-memory + persisted
          // state again here so any stale Zustand state surviving from
          // bfcache / a fast back-nav can't bleed into the new booking.
          useBookingWizard.getState().reset();
          void useBookingWizard.persist.clearStorage();
          // Strip any lingering ?step= from the URL so a subsequent Back
          // can't restore step 6 of the just-completed booking.
          window.history.replaceState({}, "", "/booking");
          return;
        }
      } catch {
        // sessionStorage unavailable (Safari private mode) — fall through.
      }
    }
    const cat = params.get("categoryId");
    const depot = params.get("depotId");
    const vehicleId = params.get("vehicleId");
    const pickup = params.get("pickup");
    const ret = params.get("return");
    if (cat) w.set("categoryId", cat);
    if (depot) {
      w.set("pickupDepotId", depot);
      w.set("returnDepotId", depot);
    }
    if (pickup) w.set("pickupDateTime", pickup);
    if (ret) w.set("returnDateTime", ret);
    if (vehicleId) w.set("preferredVehicleId", vehicleId);

    // Resolve the initial step. Precedence: explicit `?step=N` URL wins
    // (deep links, refresh on a step page), then the all-five-params
    // hand-off jumps to Vehicle, otherwise keep whatever the persisted
    // store rehydrated to. Clamp via maxReachableStep so a hostile or
    // stale URL can't skip required input.
    const stepParam = params.get("step");
    const stepFromUrl =
      stepParam && /^[1-6]$/.test(stepParam) ? (Number(stepParam) as WizardStep) : null;
    const handoffStep =
      cat && depot && vehicleId && pickup && ret ? (2 as WizardStep) : null;
    const target =
      stepFromUrl ?? handoffStep ?? useBookingWizard.getState().step;

    // Synchronous staleness: a resume past step 1 whose pickup time is now too
    // late (past, or within the booking cut-off) can't be completed — wipe it
    // and start over at step 1 with a notice. Only meaningful past step 1
    // (step 1 IS the date picker). A fresh deep-link with a future pickup
    // passes this and seeds normally. Short-circuit before step resolution so
    // the lingering `?pickup=`/`?step=` can't re-anchor the stale deep step.
    if (target >= 2 && isPickupTooLate(useBookingWizard.getState().pickupDateTime)) {
      resetStaleBookingWizard("PICKUP_PASSED");
      return;
    }

    const clamped = Math.min(
      target,
      maxReachableStep(useBookingWizard.getState()),
    ) as WizardStep;
    useBookingWizard.getState()._setStepSilent(clamped);
    if (typeof window !== "undefined") {
      // Anchor the first history entry so popstate has wizardStep in
      // event.state, and align the URL with the clamped step.
      const url = new URL(window.location.href);
      url.searchParams.set("step", String(clamped));
      window.history.replaceState({ wizardStep: clamped }, "", url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser back/forward sync: when the user pops the history stack,
  // mirror the new step into the store via the silent setter so we
  // don't re-push another entry.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPopState(event: PopStateEvent) {
      const fromState = (event.state as { wizardStep?: number } | null)?.wizardStep;
      const fromUrl = new URLSearchParams(window.location.search).get("step");
      const candidate =
        typeof fromState === "number" && fromState >= 1 && fromState <= 6
          ? fromState
          : fromUrl && /^[1-6]$/.test(fromUrl)
            ? Number(fromUrl)
            : 1;
      const clamped = Math.min(
        candidate,
        maxReachableStep(useBookingWizard.getState()),
      ) as WizardStep;
      useBookingWizard.getState()._setStepSilent(clamped);
      if (clamped !== candidate) {
        // The popped step is no longer reachable (e.g. user cleared a
        // field). Correct the URL in place so a future Back doesn't
        // re-land on the same invalid step.
        const url = new URL(window.location.href);
        url.searchParams.set("step", String(clamped));
        window.history.replaceState({ wizardStep: clamped }, "", url);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const stepContent = (
    <>
      {step === 1 && <StepSearch />}
      {step === 2 && <StepVehicle />}
      {step === 3 && <StepExtras />}
      {step === 4 && <StepDetails />}
      {step === 5 && <StepReview />}
      {step === 6 && <StepPayment />}
    </>
  );

  // Desktop is the hydration-matching default (useIsMobile returns false on
  // the server and first render). Mobile shell is opt-in via feature flag +
  // client-side media query. When the flag is off we render the desktop
  // shell for everyone — that's the current behaviour, unchanged.
  if (flags.wizard_mobile_shell && isMobile) {
    return <BookingShellMobile>{stepContent}</BookingShellMobile>;
  }
  return <BookingShellDesktop>{stepContent}</BookingShellDesktop>;
}

export function BookingWizardClient({ flags }: { flags: BookingFlags }) {
  return (
    <SessionProvider>
      <BookingFlagsProvider value={flags}>
        <Suspense fallback={<LoadingBlock padded="lg" className="container" />}>
          <BookingWizardInner flags={flags} />
        </Suspense>
      </BookingFlagsProvider>
    </SessionProvider>
  );
}
