"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Vehicle = {
  id: string;
  internalCode: string;
  make: string;
  model: string;
  rego: string;
};

type CategoryOption = {
  id: string;
  name: string;
};

type DisposeStatus = "SOLD" | "WRITTEN_OFF" | "END_OF_LIFE" | "STOLEN";

type VehicleAction =
  | { kind: "REASSIGN"; targetCategoryId: string }
  | { kind: "DISPOSE"; targetStatus: DisposeStatus; reason: string; salePrice?: number };

const DISPOSE_LABELS: Record<DisposeStatus, string> = {
  SOLD: "Sold",
  WRITTEN_OFF: "Written off",
  END_OF_LIFE: "End of life",
  STOLEN: "Stolen",
};

export function CategoryArchiveDialog({
  open,
  onOpenChange,
  category,
  vehicles,
  otherCategories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: { id: string; name: string };
  vehicles: Vehicle[];
  otherCategories: CategoryOption[];
}) {
  const util = trpc.useUtils();
  const [step, setStep] = useState<1 | 2>(1);
  const [actions, setActions] = useState<Record<string, VehicleAction>>({});

  const archive = trpc.admin.archiveCategory.useMutation({
    onSuccess: () => {
      util.admin.listAllCategories.invalidate();
      onOpenChange(false);
      setStep(1);
      setActions({});
    },
  });

  const allHandled = useMemo(
    () => vehicles.every((v) => actions[v.id]),
    [vehicles, actions],
  );

  function setAction(vehicleId: string, action: VehicleAction) {
    setActions((prev) => ({ ...prev, [vehicleId]: action }));
  }

  function bulkReassign(targetCategoryId: string) {
    setActions(
      Object.fromEntries(
        vehicles.map((v) => [v.id, { kind: "REASSIGN", targetCategoryId } as VehicleAction]),
      ),
    );
  }

  function bulkDispose(targetStatus: DisposeStatus) {
    setActions(
      Object.fromEntries(
        vehicles.map((v) => [
          v.id,
          { kind: "DISPOSE", targetStatus, reason: `Category ${category.name} archived` } as VehicleAction,
        ]),
      ),
    );
  }

  function onSubmit() {
    archive.mutate({
      id: category.id,
      vehicleActions: vehicles.map((v) => {
        const a = actions[v.id];
        if (!a) throw new Error(`Missing action for ${v.internalCode}`);
        if (a.kind === "REASSIGN") {
          return { action: "REASSIGN" as const, vehicleId: v.id, targetCategoryId: a.targetCategoryId };
        }
        return {
          action: "DISPOSE" as const,
          vehicleId: v.id,
          targetStatus: a.targetStatus,
          reason: a.reason,
          salePrice: a.salePrice,
        };
      }),
    });
  }

  const reassignCount = Object.values(actions).filter((a) => a.kind === "REASSIGN").length;
  const disposeCount = Object.values(actions).filter((a) => a.kind === "DISPOSE").length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setStep(1); setActions({}); } onOpenChange(o); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Archive “{category.name}”</DialogTitle>
          <DialogDescription>
            {vehicles.length === 0
              ? "This category has no active vehicles. Confirm to archive."
              : `Decide what to do with the ${vehicles.length} vehicle(s) in this category before it's archived.`}
          </DialogDescription>
        </DialogHeader>

        {vehicles.length === 0 ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              The category will be hidden from /fleet and from the public pricing page, but
              its booking history and audit log are preserved.
            </p>
          </div>
        ) : step === 1 ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="mb-2 font-medium">Bulk actions</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Reassign all to:</span>
                <Select onValueChange={(v) => bulkReassign(v)}>
                  <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Choose category" /></SelectTrigger>
                  <SelectContent>
                    {otherCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="mx-2 text-xs text-muted-foreground">or dispose all as:</span>
                {(Object.keys(DISPOSE_LABELS) as DisposeStatus[]).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => bulkDispose(s)}
                  >
                    {DISPOSE_LABELS[s]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="divide-y rounded-md border">
              {vehicles.map((v) => (
                <VehicleActionRow
                  key={v.id}
                  vehicle={v}
                  action={actions[v.id]}
                  otherCategories={otherCategories}
                  onChange={(a) => setAction(v.id, a)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-medium">Confirm archival</div>
                <div className="mt-1 text-xs">
                  {reassignCount > 0 && <>Reassign {reassignCount} vehicle(s). </>}
                  {disposeCount > 0 && <>Dispose {disposeCount} vehicle(s). </>}
                  Category will be hidden from the public site. Future bookings for
                  disposed vehicles will be auto-reassigned where possible.
                </div>
              </div>
            </div>
            <ArchiveSummary vehicles={vehicles} actions={actions} otherCategories={otherCategories} />
          </div>
        )}

        {archive.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {archive.error.message}
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {vehicles.length > 0 && step === 1 && (
            <Button type="button" disabled={!allHandled} onClick={() => setStep(2)}>
              Review <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {(vehicles.length === 0 || step === 2) && (
            <Button
              type="button"
              variant="destructive"
              disabled={archive.isPending}
              onClick={onSubmit}
            >
              {archive.isPending ? "Archiving…" : "Archive category"}
            </Button>
          )}
          {step === 2 && (
            <Button type="button" variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VehicleActionRow({
  vehicle,
  action,
  otherCategories,
  onChange,
}: {
  vehicle: Vehicle;
  action: VehicleAction | undefined;
  otherCategories: CategoryOption[];
  onChange: (a: VehicleAction) => void;
}) {
  const kind = action?.kind ?? "";

  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{vehicle.internalCode}</div>
        <div className="truncate text-xs text-muted-foreground">
          {vehicle.make} {vehicle.model} · {vehicle.rego}
        </div>
      </div>
      <Select
        value={kind}
        onValueChange={(v) => {
          if (v === "REASSIGN") {
            onChange({ kind: "REASSIGN", targetCategoryId: otherCategories[0]?.id ?? "" });
          } else if (v === "DISPOSE") {
            onChange({ kind: "DISPOSE", targetStatus: "END_OF_LIFE", reason: "Category archived" });
          }
        }}
      >
        <SelectTrigger className="w-36"><SelectValue placeholder="Action" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="REASSIGN">Reassign</SelectItem>
          <SelectItem value="DISPOSE">Dispose</SelectItem>
        </SelectContent>
      </Select>
      {action?.kind === "REASSIGN" && (
        <Select
          value={action.targetCategoryId}
          onValueChange={(v) => onChange({ kind: "REASSIGN", targetCategoryId: v })}
        >
          <SelectTrigger className="w-52"><SelectValue placeholder="Target category" /></SelectTrigger>
          <SelectContent>
            {otherCategories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {action?.kind === "DISPOSE" && (
        <>
          <Select
            value={action.targetStatus}
            onValueChange={(v) =>
              onChange({ ...action, targetStatus: v as DisposeStatus })
            }
          >
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(DISPOSE_LABELS) as DisposeStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{DISPOSE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {action.targetStatus === "SOLD" && (
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="Sale price"
              className="w-32"
              value={action.salePrice ?? ""}
              onChange={(e) =>
                onChange({
                  ...action,
                  salePrice: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function ArchiveSummary({
  vehicles,
  actions,
  otherCategories,
}: {
  vehicles: Vehicle[];
  actions: Record<string, VehicleAction>;
  otherCategories: CategoryOption[];
}) {
  const nameById = new Map(otherCategories.map((c) => [c.id, c.name]));
  return (
    <div className="space-y-1 rounded-md border p-3 text-sm">
      {vehicles.map((v) => {
        const a = actions[v.id];
        return (
          <div key={v.id} className="flex items-center justify-between gap-2 border-b pb-1 last:border-0 last:pb-0">
            <span className="font-medium">{v.internalCode}</span>
            <span className="text-xs text-muted-foreground">
              {a?.kind === "REASSIGN"
                ? `→ Reassign to ${nameById.get(a.targetCategoryId) ?? "?"}`
                : a?.kind === "DISPOSE"
                  ? `→ Dispose as ${DISPOSE_LABELS[a.targetStatus]}${a.salePrice ? ` (A$${a.salePrice})` : ""}`
                  : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
