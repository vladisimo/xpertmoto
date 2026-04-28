"use client";
import { useSession } from "next-auth/react";
import { WizardProgress as GenericWizardProgress } from "@/components/shared/wizard-progress";
import { useBookingWizard, type WizardStep } from "@/stores/booking-wizard";

export const STEPS = [
  { label: "Search" },
  { label: "Vehicle" },
  { label: "Extras" },
  { label: "Details" },
  { label: "Review" },
  { label: "Payment" },
] as const;

/** Step 4 is the auth gate — Review/Payment are unreachable without a session. */
const AUTH_GATE_STEP = 4;

/** Human label for a 1-indexed step number, or null if out of range. */
export function bookingStepLabel(step: number): string | null {
  return STEPS[step - 1]?.label ?? null;
}

export function WizardProgress() {
  const step = useBookingWizard((s) => s.step);
  const setStep = useBookingWizard((s) => s.setStep);
  const { data: session } = useSession();
  const isAuthed = !!session?.user;
  return (
    <GenericWizardProgress
      steps={STEPS}
      current={step}
      onStepClick={(n) => setStep(n as WizardStep)}
      canNavigateTo={(n) => (n > AUTH_GATE_STEP ? isAuthed : true)}
    />
  );
}
