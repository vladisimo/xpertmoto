"use client";

import { useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/lib/trpc/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import type { VehicleWithRelations } from "./vehicle-detail-types";

export type VehicleEditSection = "identity" | "compliance" | "assignment" | "financial";

const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
const DEPRECIATION_METHODS = ["STRAIGHT_LINE", "DIMINISHING_VALUE"] as const;

const identitySchema = z.object({
  internalCode: z.string().min(1, "Required"),
  rego: z.string().min(1, "Required"),
  regoState: z.string().min(2, "Required"),
  vin: z.string(),
  engineNumber: z.string(),
  make: z.string().min(1, "Required"),
  model: z.string().min(1, "Required"),
  year: z.coerce.number().int().min(1900).max(2100),
  colour: z.string().min(1, "Required"),
  fuelType: z.string(),
  currentOdometerKm: z.coerce.number().int().min(0),
});

const complianceSchema = z.object({
  regoExpiry: z.string(),
  ctpExpiry: z.string(),
  insuranceExpiry: z.string(),
  insurancePolicyNumber: z.string(),
  warrantyExpiry: z.string(),
  lastServiceDate: z.string(),
  lastServiceKm: z.string(),
  nextServiceDueDate: z.string(),
  nextServiceDueKm: z.string(),
});

const assignmentSchema = z.object({
  categoryId: z.string().min(1, "Required"),
  depotId: z.string().min(1, "Required"),
  condition: z.enum(CONDITIONS),
});

const financialSchema = z.object({
  purchasePrice: z.string(),
  purchaseDate: z.string(),
  depreciationMethod: z.enum([...DEPRECIATION_METHODS, ""] as [string, ...string[]]),
  depreciationRate: z.string(),
});

type IdentityValues = z.infer<typeof identitySchema>;
type ComplianceValues = z.infer<typeof complianceSchema>;
type AssignmentValues = z.infer<typeof assignmentSchema>;
type FinancialValues = z.infer<typeof financialSchema>;

function toInputDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function fromInputDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numOrNull(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

function mergeOption<T extends { id: string; name: string }>(
  list: T[] | undefined,
  current: { id: string; name: string },
): Array<{ id: string; name: string }> {
  const items = list ?? [];
  if (items.some((i) => i.id === current.id)) return items;
  return [current, ...items];
}

const SECTION_COPY: Record<VehicleEditSection, { title: string; description: string }> = {
  identity:   { title: "Edit identity",   description: "Registration, chassis numbers, and basic identifiers." },
  compliance: { title: "Edit compliance", description: "Expiry dates and scheduled services." },
  assignment: { title: "Edit assignment", description: "Category, home depot, and condition." },
  financial:  { title: "Edit financial",  description: "Purchase cost and depreciation inputs." },
};

export function VehicleEditSheet({
  section,
  vehicle,
  open,
  onOpenChange,
}: {
  section: VehicleEditSection | null;
  vehicle: VehicleWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = section ? SECTION_COPY[section] : { title: "", description: "" };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[560px]">
        <SheetHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <SheetTitle className="text-xl">{copy.title}</SheetTitle>
          <SheetDescription>{copy.description}</SheetDescription>
        </SheetHeader>
        {section === "identity"   && <IdentityForm   vehicle={vehicle} onDone={() => onOpenChange(false)} />}
        {section === "compliance" && <ComplianceForm vehicle={vehicle} onDone={() => onOpenChange(false)} />}
        {section === "assignment" && <AssignmentForm vehicle={vehicle} onDone={() => onOpenChange(false)} />}
        {section === "financial"  && <FinancialForm  vehicle={vehicle} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function FormShell<T extends FieldValues>({
  form,
  onSubmit,
  children,
  pending,
  error,
}: {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => void;
  children: React.ReactNode;
  pending: boolean;
  error: string | null;
}) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <FormGrid cols={2}>
            {children}
            {error && (
              <FormGridRow>
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              </FormGridRow>
            )}
          </FormGrid>
        </div>
        <div className="shrink-0 border-t px-6 py-4">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function IdentityForm({ vehicle: v, onDone }: { vehicle: VehicleWithRelations; onDone: () => void }) {
  const utils = trpc.useUtils();
  const update = trpc.fleet.updateVehicle.useMutation({
    onSuccess: () => {
      utils.fleet.vehicleDetail.invalidate({ id: v.id });
      onDone();
    },
  });
  const form = useForm<IdentityValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      internalCode: v.internalCode,
      rego: v.rego,
      regoState: v.regoState,
      vin: v.vin ?? "",
      engineNumber: v.engineNumber ?? "",
      make: v.make,
      model: v.model,
      year: v.year,
      colour: v.colour,
      fuelType: v.fuelType ?? "",
      currentOdometerKm: v.currentOdometerKm,
    },
  });

  return (
    <FormShell
      form={form}
      pending={update.isPending}
      error={update.error?.message ?? null}
      onSubmit={(values) => {
        update.mutate({
          id: v.id,
          internalCode: values.internalCode,
          rego: values.rego,
          regoState: values.regoState,
          vin: strOrNull(values.vin),
          engineNumber: strOrNull(values.engineNumber),
          make: values.make,
          model: values.model,
          year: values.year,
          colour: values.colour,
          fuelType: strOrNull(values.fuelType),
          currentOdometerKm: values.currentOdometerKm,
        });
      }}
    >
      <FormField control={form.control} name="internalCode" render={({ field }) => (
        <FormItem><FormLabel>Internal code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="rego" render={({ field }) => (
        <FormItem><FormLabel>Rego</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="regoState" render={({ field }) => (
        <FormItem><FormLabel>Rego state</FormLabel><FormControl><Input maxLength={3} {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="make" render={({ field }) => (
        <FormItem><FormLabel>Make</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="model" render={({ field }) => (
        <FormItem className="md:col-span-2"><FormLabel>Model</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="year" render={({ field }) => (
        <FormItem><FormLabel>Year</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="colour" render={({ field }) => (
        <FormItem><FormLabel>Colour</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="vin" render={({ field }) => (
        <FormItem><FormLabel>VIN</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="engineNumber" render={({ field }) => (
        <FormItem><FormLabel>Engine #</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="fuelType" render={({ field }) => (
        <FormItem><FormLabel>Fuel type</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="currentOdometerKm" render={({ field }) => (
        <FormItem><FormLabel>Odometer (km)</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
      )} />
    </FormShell>
  );
}

function ComplianceForm({ vehicle: v, onDone }: { vehicle: VehicleWithRelations; onDone: () => void }) {
  const utils = trpc.useUtils();
  const update = trpc.fleet.updateVehicle.useMutation({
    onSuccess: () => {
      utils.fleet.vehicleDetail.invalidate({ id: v.id });
      onDone();
    },
  });
  const form = useForm<ComplianceValues>({
    resolver: zodResolver(complianceSchema),
    defaultValues: {
      regoExpiry: toInputDate(v.regoExpiry),
      ctpExpiry: toInputDate(v.ctpExpiry),
      insuranceExpiry: toInputDate(v.insuranceExpiry),
      insurancePolicyNumber: v.insurancePolicyNumber ?? "",
      warrantyExpiry: toInputDate(v.warrantyExpiry),
      lastServiceDate: toInputDate(v.lastServiceDate),
      lastServiceKm: v.lastServiceKm != null ? String(v.lastServiceKm) : "",
      nextServiceDueDate: toInputDate(v.nextServiceDueDate),
      nextServiceDueKm: v.nextServiceDueKm != null ? String(v.nextServiceDueKm) : "",
    },
  });

  return (
    <FormShell
      form={form}
      pending={update.isPending}
      error={update.error?.message ?? null}
      onSubmit={(values) => {
        update.mutate({
          id: v.id,
          regoExpiry: fromInputDate(values.regoExpiry),
          ctpExpiry: fromInputDate(values.ctpExpiry),
          insuranceExpiry: fromInputDate(values.insuranceExpiry),
          insurancePolicyNumber: strOrNull(values.insurancePolicyNumber),
          warrantyExpiry: fromInputDate(values.warrantyExpiry),
          lastServiceDate: fromInputDate(values.lastServiceDate),
          lastServiceKm: numOrNull(values.lastServiceKm),
          nextServiceDueDate: fromInputDate(values.nextServiceDueDate),
          nextServiceDueKm: numOrNull(values.nextServiceDueKm),
        });
      }}
    >
      <FormField control={form.control} name="regoExpiry" render={({ field }) => (
        <FormItem><FormLabel>Rego expiry</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="ctpExpiry" render={({ field }) => (
        <FormItem><FormLabel>CTP expiry</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="insuranceExpiry" render={({ field }) => (
        <FormItem><FormLabel>Insurance expiry</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="insurancePolicyNumber" render={({ field }) => (
        <FormItem><FormLabel>Insurance policy #</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="warrantyExpiry" render={({ field }) => (
        <FormItem><FormLabel>Warranty expiry</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="lastServiceDate" render={({ field }) => (
        <FormItem><FormLabel>Last service date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="lastServiceKm" render={({ field }) => (
        <FormItem><FormLabel>Last service km</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="nextServiceDueDate" render={({ field }) => (
        <FormItem><FormLabel>Next service date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="nextServiceDueKm" render={({ field }) => (
        <FormItem><FormLabel>Next service km</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
      )} />
    </FormShell>
  );
}

function AssignmentForm({ vehicle: v, onDone }: { vehicle: VehicleWithRelations; onDone: () => void }) {
  const utils = trpc.useUtils();
  const update = trpc.fleet.updateVehicle.useMutation({
    onSuccess: () => {
      utils.fleet.vehicleDetail.invalidate({ id: v.id });
      onDone();
    },
  });
  const { data: depots } = trpc.depot.list.useQuery();
  const { data: categories } = trpc.vehicle.listCategories.useQuery();

  const form = useForm<AssignmentValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: {
      categoryId: v.categoryId,
      depotId: v.depotId,
      condition: (CONDITIONS as readonly string[]).includes(v.condition)
        ? (v.condition as AssignmentValues["condition"])
        : "GOOD",
    },
  });

  const categoryOptions = mergeOption(categories, { id: v.categoryId, name: v.category.name });
  const depotOptions = mergeOption(depots, { id: v.depotId, name: v.depot.name });

  return (
    <FormShell
      form={form}
      pending={update.isPending}
      error={update.error?.message ?? null}
      onSubmit={(values) => {
        update.mutate({
          id: v.id,
          categoryId: values.categoryId,
          depotId: values.depotId,
          condition: values.condition,
        });
      }}
    >
      <FormField control={form.control} name="categoryId" render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>Category</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger></FormControl>
            <SelectContent>
              {categoryOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={form.control} name="depotId" render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>Home depot</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue placeholder="Select depot" /></SelectTrigger></FormControl>
            <SelectContent>
              {depotOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={form.control} name="condition" render={({ field }) => (
        <FormItem>
          <FormLabel>Condition</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
            <SelectContent>
              {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />
    </FormShell>
  );
}

function FinancialForm({ vehicle: v, onDone }: { vehicle: VehicleWithRelations; onDone: () => void }) {
  const utils = trpc.useUtils();
  const update = trpc.fleet.updateVehicle.useMutation({
    onSuccess: () => {
      utils.fleet.vehicleDetail.invalidate({ id: v.id });
      onDone();
    },
  });
  const form = useForm<FinancialValues>({
    resolver: zodResolver(financialSchema),
    defaultValues: {
      purchasePrice: v.purchasePrice != null ? String(v.purchasePrice) : "",
      purchaseDate: toInputDate(v.purchaseDate),
      depreciationMethod: (DEPRECIATION_METHODS as readonly string[]).includes(v.depreciationMethod ?? "")
        ? (v.depreciationMethod as (typeof DEPRECIATION_METHODS)[number])
        : "",
      depreciationRate: v.depreciationRate != null ? String(v.depreciationRate) : "",
    },
  });

  return (
    <FormShell
      form={form}
      pending={update.isPending}
      error={update.error?.message ?? null}
      onSubmit={(values) => {
        update.mutate({
          id: v.id,
          purchasePrice: numOrNull(values.purchasePrice),
          purchaseDate: fromInputDate(values.purchaseDate),
          depreciationMethod:
            values.depreciationMethod === "" ? null : (values.depreciationMethod as (typeof DEPRECIATION_METHODS)[number]),
          depreciationRate: numOrNull(values.depreciationRate),
        });
      }}
    >
      <FormField control={form.control} name="purchasePrice" render={({ field }) => (
        <FormItem>
          <FormLabel>Purchase price (A$)</FormLabel>
          <FormControl><Input type="number" min={0} step="0.01" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={form.control} name="purchaseDate" render={({ field }) => (
        <FormItem><FormLabel>Purchase date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
      )} />
      <FormField control={form.control} name="depreciationMethod" render={({ field }) => (
        <FormItem>
          <FormLabel>Depreciation method</FormLabel>
          <Select onValueChange={field.onChange} value={field.value}>
            <FormControl><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger></FormControl>
            <SelectContent>
              <SelectItem value="STRAIGHT_LINE">Straight line</SelectItem>
              <SelectItem value="DIMINISHING_VALUE">Diminishing value</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />
      <FormField control={form.control} name="depreciationRate" render={({ field }) => (
        <FormItem>
          <FormLabel>Depreciation rate (% / yr)</FormLabel>
          <FormControl><Input type="number" min={0} step="0.01" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
    </FormShell>
  );
}
