"use client";
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { useBookingWizard } from "@/stores/booking-wizard";
import { Button } from "@/components/ui/button";
import { VehiclePicker } from "./vehicle-picker";
import { useStepContinueAction } from "@/hooks/use-step-continue-action";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";

export function StepVehicle() {
  const w = useBookingWizard();
  const layout = useWizardShellLayout();
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const blockRef = useRef<HTMLDivElement | null>(null);

  const { data: availability } = trpc.booking.availability.useQuery(
    {
      categoryId: w.categoryId ?? "",
      depotId: w.pickupDepotId ?? "",
      pickupDateTime: new Date(w.pickupDateTime ?? new Date()),
      returnDateTime: new Date(w.returnDateTime ?? new Date()),
    },
    { enabled: !!(w.categoryId && w.pickupDepotId && w.pickupDateTime && w.returnDateTime) },
  );

  const canContinue = !!availability && availability.available > 0;

  // Finding #20: with nothing chosen, `w.next()` clamped straight back to
  // step 2 and Continue looked dead. Surface the store's refusal reason
  // instead — the advance rules themselves are untouched.
  function handleContinue() {
    const blocked = w.next();
    setBlockMessage(blocked?.message ?? null);
    if (blocked) {
      requestAnimationFrame(() => {
        blockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }

  // Making a vehicle decision answers the notice — clear it.
  useEffect(() => {
    setBlockMessage(null);
  }, [w.preferredVehicleId, w.noPreference]);

  useStepContinueAction({
    label: "Continue",
    disabled: !canContinue,
    onClick: handleContinue,
  });

  return (
    <div className="space-y-6">
      <h2 className="h2 hidden md:block">Choose your vehicle</h2>

      {blockMessage && (
        <div
          ref={blockRef}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{blockMessage}</span>
        </div>
      )}

      <VehiclePicker />

      {layout === "desktop" && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => w.back()}>Back</Button>
          <Button variant="cta" disabled={!canContinue} onClick={handleContinue}>Continue</Button>
        </div>
      )}
    </div>
  );
}
