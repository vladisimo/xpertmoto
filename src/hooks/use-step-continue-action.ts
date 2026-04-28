"use client";

import { useEffect, useRef } from "react";
import { useBookingWizard } from "@/stores/booking-wizard";

/**
 * Register the step's primary "Continue" action so the mobile shell can
 * render it in its sticky bottom bar. The desktop shell ignores the
 * registry and lets each step render its own inline Back/Continue row
 * (which is the better ergonomic on a large screen).
 *
 * We route `onClick` through a ref so the callback always sees the
 * latest closure (react-hook-form submit handlers, mutation refs, etc.)
 * without churning the store on every render. Only the primitive
 * `label`/`disabled`/`pending` flags re-run the effect.
 */
export function useStepContinueAction(args: {
  label: string;
  disabled: boolean;
  pending?: boolean;
  onClick: () => void | Promise<void>;
}): void {
  const { label, disabled, pending = false, onClick } = args;
  const setStepContinueAction = useBookingWizard((s) => s.setStepContinueAction);
  const onClickRef = useRef(onClick);

  // Keep the ref pointing at the latest closure. Commits after render,
  // which is fine — the stored `() => onClickRef.current()` wrapper is
  // only invoked from a user click after the render cycle has flushed.
  useEffect(() => {
    onClickRef.current = onClick;
  });

  useEffect(() => {
    setStepContinueAction({
      label,
      disabled,
      pending,
      onClick: () => onClickRef.current(),
    });
    return () => setStepContinueAction(null);
  }, [label, disabled, pending, setStepContinueAction]);
}
