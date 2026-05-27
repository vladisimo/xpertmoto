"use client";

import { useEffect, useState } from "react";
import { useBookingWizard } from "@/stores/booking-wizard";

function useWizardResumable(): boolean {
  const step = useBookingWizard((s) => s.step);
  // Wizard state lives in localStorage; gating on a mount flag prevents an
  // SSR/hydration mismatch where the server would always render "Book Now".
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted && step >= 2;
}

type BookingCtaTextProps = {
  initial?: React.ReactNode;
  resume?: React.ReactNode;
};

export function BookingCtaText({
  initial = "Book Now",
  resume = "Continue booking",
}: BookingCtaTextProps) {
  const resumable = useWizardResumable();
  return <>{resumable ? resume : initial}</>;
}

type BookingResetLinkProps = {
  className?: string;
  children?: React.ReactNode;
};

export function BookingResetLink({
  className = "text-sm text-background/70 underline-offset-4 hover:text-background hover:underline",
  children = "Start over",
}: BookingResetLinkProps) {
  const resumable = useWizardResumable();
  const reset = useBookingWizard((s) => s.reset);
  if (!resumable) return null;
  return (
    <button type="button" onClick={reset} className={className}>
      {children}
    </button>
  );
}

export { useWizardResumable };
