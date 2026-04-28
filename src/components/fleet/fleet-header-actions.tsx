"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VehicleOnboardSheet } from "./vehicle-onboard-sheet";
import {
  VehicleActionButtons,
  VehicleActionSheetsProvider,
} from "./vehicle-action-sheets";

export function FleetHeaderActions() {
  const [onboardOpen, setOnboardOpen] = useState(false);

  return (
    <VehicleActionSheetsProvider>
      <Button onClick={() => setOnboardOpen(true)}>
        <Plus className="h-4 w-4" />
        Onboard vehicle
      </Button>
      <VehicleActionButtons />
      <VehicleOnboardSheet open={onboardOpen} onOpenChange={setOnboardOpen} />
    </VehicleActionSheetsProvider>
  );
}
