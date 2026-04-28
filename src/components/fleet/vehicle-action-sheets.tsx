"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkOrderSheet } from "./work-order-sheet";
import { InspectionSheet } from "./inspection-sheet";
import { IncidentSheet } from "./incident-sheet";
import { InfringementSheet } from "./infringement-sheet";

type SheetKind = "workOrder" | "inspection" | "incident" | "infringement";

type Ctx = {
  open: (kind: SheetKind) => void;
};

const VehicleActionsContext = createContext<Ctx | null>(null);

export function useVehicleActions(): Ctx {
  const ctx = useContext(VehicleActionsContext);
  if (!ctx) throw new Error("useVehicleActions must be used inside <VehicleActionSheetsProvider>");
  return ctx;
}

type SheetState = {
  workOrder: boolean;
  inspection: boolean;
  incident: boolean;
  infringement: boolean;
};

const EMPTY: SheetState = { workOrder: false, inspection: false, incident: false, infringement: false };

export function VehicleActionSheetsProvider({
  vehicleId,
  children,
}: {
  vehicleId?: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<SheetState>(EMPTY);

  const open = useCallback((kind: SheetKind) => {
    setState((s) => ({ ...s, [kind]: true }));
  }, []);

  const setOpen = useCallback((kind: SheetKind, value: boolean) => {
    setState((s) => ({ ...s, [kind]: value }));
  }, []);

  const ctx = useMemo<Ctx>(() => ({ open }), [open]);

  return (
    <VehicleActionsContext.Provider value={ctx}>
      {children}
      <WorkOrderSheet
        open={state.workOrder}
        onOpenChange={(v) => setOpen("workOrder", v)}
        vehicleId={vehicleId}
      />
      <InspectionSheet
        open={state.inspection}
        onOpenChange={(v) => setOpen("inspection", v)}
        vehicleId={vehicleId}
      />
      <IncidentSheet
        open={state.incident}
        onOpenChange={(v) => setOpen("incident", v)}
        vehicleId={vehicleId}
      />
      <InfringementSheet
        open={state.infringement}
        onOpenChange={(v) => setOpen("infringement", v)}
        vehicleId={vehicleId}
      />
    </VehicleActionsContext.Provider>
  );
}

export function VehicleActionButtons() {
  const { open } = useVehicleActions();
  return (
    <>
      <Button variant="secondary" onClick={() => open("workOrder")}>
        <Plus className="h-4 w-4" />
        New work order
      </Button>
      <Button variant="secondary" onClick={() => open("inspection")}>
        <Plus className="h-4 w-4" />
        New inspection
      </Button>
      <Button variant="secondary" onClick={() => open("incident")}>
        <Plus className="h-4 w-4" />
        Report incident
      </Button>
      <Button variant="secondary" onClick={() => open("infringement")}>
        <Plus className="h-4 w-4" />
        Record infringement
      </Button>
    </>
  );
}
