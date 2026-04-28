"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/lib/trpc/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid } from "@/components/forms/form-grid";

const TYPES = ["PRE_HIRE", "POST_HIRE", "ROUTINE", "INCIDENT"] as const;
const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
const ZONES = [
  "Front panel",
  "Left side",
  "Right side",
  "Rear panel",
  "Seat",
  "Mirror (L)",
  "Mirror (R)",
  "Front wheel",
  "Rear wheel",
] as const;

const schema = z.object({
  vehicleId: z.string().min(1, "Required"),
  type: z.enum(TYPES),
  odometerKm: z.coerce.number().min(0),
  fuelLevel: z.coerce.number().min(0).max(100),
  overallCondition: z.enum(CONDITIONS),
  lightsWorking: z.boolean().default(true),
  hornWorking: z.boolean().default(true),
  indicatorsWorking: z.boolean().default(true),
  engineRunning: z.boolean().default(true),
  notes: z.string().optional(),
  damageZones: z.array(z.string()).default([]),
});
type Values = z.infer<typeof schema>;

const DEFAULTS: Values = {
  vehicleId: "",
  type: "ROUTINE",
  odometerKm: 0,
  fuelLevel: 100,
  overallCondition: "GOOD",
  lightsWorking: true,
  hornWorking: true,
  indicatorsWorking: true,
  engineRunning: true,
  notes: "",
  damageZones: [],
};

function humanize(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function InspectionSheet({
  open,
  onOpenChange,
  vehicleId: preselectedVehicleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId?: string;
}) {
  const router = useRouter();
  const { data: vehicles } = trpc.vehicle.list.useQuery({ take: 200 });
  const create = trpc.inspection.create.useMutation();

  const initial: Values = { ...DEFAULTS, vehicleId: preselectedVehicleId ?? "" };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const damageZones = form.watch("damageZones");
  const vehicleId = form.watch("vehicleId");
  const vehicle = vehicles?.items.find((v) => v.id === vehicleId);

  function toggleZone(z: string) {
    const current = form.getValues("damageZones");
    form.setValue(
      "damageZones",
      current.includes(z) ? current.filter((x) => x !== z) : [...current, z],
    );
  }

  async function onSubmit(values: Values) {
    if (!vehicle) return;
    await create.mutateAsync({
      vehicleId: values.vehicleId,
      type: values.type,
      depotId: vehicle.depotId,
      odometerKm: values.odometerKm,
      fuelLevel: values.fuelLevel,
      overallCondition: values.overallCondition,
      lightsWorking: values.lightsWorking,
      hornWorking: values.hornWorking,
      indicatorsWorking: values.indicatorsWorking,
      engineRunning: values.engineRunning,
      notes: values.notes || undefined,
      damageMarkers: values.damageZones.map((z) => ({
        x: 0.5,
        y: 0.5,
        severity: "MINOR" as const,
        note: z,
        source: "staff" as const,
      })),
    });
    form.reset(initial);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) form.reset(initial);
        onOpenChange(v);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-[640px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-xl">New inspection</SheetTitle>
          <SheetDescription>Record a vehicle inspection with condition and damage notes.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              <FormGrid cols={2}>
                {!preselectedVehicleId && (
                  <FormField
                    control={form.control}
                    name="vehicleId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vehicle</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select vehicle" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {vehicles?.items.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.internalCode} · {v.make} {v.model}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {humanize(t)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>

              <FormGrid cols={3}>
                <FormField
                  control={form.control}
                  name="odometerKm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Odometer</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fuelLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fuel %</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={100} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="overallCondition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Overall</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CONDITIONS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {humanize(c)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>

              <div className="grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ["lightsWorking", "Lights working"],
                    ["hornWorking", "Horn working"],
                    ["indicatorsWorking", "Indicators working"],
                    ["engineRunning", "Engine starts / runs smoothly"],
                  ] as const
                ).map(([name, label]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span>{label}</span>
                      </label>
                    )}
                  />
                ))}
              </div>

              <div className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold">Damage zones</h3>
                  <p className="text-xs text-muted-foreground">Tap any panel that has visible damage.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {ZONES.map((z) => {
                    const active = damageZones.includes(z);
                    return (
                      <button
                        key={z}
                        type="button"
                        onClick={() => toggleZone(z)}
                        className={`rounded-md border p-2 text-left transition-colors ${
                          active
                            ? "border-destructive bg-destructive/10 text-destructive"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        {active ? "⚠ " : ""}
                        {z}
                      </button>
                    );
                  })}
                </div>
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <textarea
                        {...field}
                        className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {create.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {create.error.message}
                </div>
              )}
            </div>
            <div className="border-t px-6 py-4 shrink-0">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {create.isPending ? "Saving…" : "Save inspection"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
