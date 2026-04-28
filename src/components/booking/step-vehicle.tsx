"use client";
import { trpc } from "@/lib/trpc/client";
import { useBookingWizard } from "@/stores/booking-wizard";
import { Button } from "@/components/ui/button";
import { VehiclePicker } from "./vehicle-picker";
import { useStepContinueAction } from "@/hooks/use-step-continue-action";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";

export function StepVehicle() {
  const w = useBookingWizard();
  const layout = useWizardShellLayout();

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

  useStepContinueAction({
    label: "Continue",
    disabled: !canContinue,
    onClick: () => w.next(),
  });

  return (
    <div className="space-y-6">
      <h2 className="h2 hidden md:block">Choose your vehicle</h2>

      <VehiclePicker />

      {layout === "desktop" && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => w.back()}>Back</Button>
          <Button disabled={!canContinue} onClick={() => w.next()}>Continue</Button>
        </div>
      )}
    </div>
  );
}
