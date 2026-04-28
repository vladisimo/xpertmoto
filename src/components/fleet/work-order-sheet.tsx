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
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";

const TYPES = [
  "ROUTINE_SERVICE",
  "TYRE_REPLACEMENT",
  "BRAKE_SERVICE",
  "BATTERY",
  "REGO_RENEWAL",
  "CTP_RENEWAL",
  "INSURANCE_RENEWAL",
  "CUSTOM",
] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

type WorkOrderType = (typeof TYPES)[number];
type Priority = (typeof PRIORITIES)[number];

const TITLE_FOR_TYPE: Record<WorkOrderType, string> = {
  ROUTINE_SERVICE: "",
  TYRE_REPLACEMENT: "Tyre replacement",
  BRAKE_SERVICE: "Brake service",
  BATTERY: "Battery replacement",
  REGO_RENEWAL: "Registration renewal",
  CTP_RENEWAL: "CTP renewal",
  INSURANCE_RENEWAL: "Insurance renewal",
  CUSTOM: "",
};

const PRIORITY_FOR_TYPE: Record<WorkOrderType, Priority> = {
  ROUTINE_SERVICE: "MEDIUM",
  TYRE_REPLACEMENT: "HIGH",
  BRAKE_SERVICE: "HIGH",
  BATTERY: "MEDIUM",
  REGO_RENEWAL: "MEDIUM",
  CTP_RENEWAL: "MEDIUM",
  INSURANCE_RENEWAL: "MEDIUM",
  CUSTOM: "MEDIUM",
};

const schema = z.object({
  vehicleId: z.string().min(1, "Required"),
  type: z.enum(TYPES),
  priority: z.enum(PRIORITIES),
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  estimatedHours: z.coerce.number().min(0).optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
});
type Values = z.infer<typeof schema>;

const DEFAULTS: Values = {
  vehicleId: "",
  type: "ROUTINE_SERVICE",
  priority: "MEDIUM",
  title: "",
  description: "",
  estimatedHours: 2,
  estimatedCost: 0,
};

function humanize(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function WorkOrderSheet({
  open,
  onOpenChange,
  vehicleId,
  defaultType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId?: string;
  defaultType?: WorkOrderType;
}) {
  const router = useRouter();
  const { data: vehicles } = trpc.vehicle.list.useQuery({ take: 200 }, { enabled: !vehicleId });
  const create = trpc.fleet.createWorkOrder.useMutation();

  const initial: Values = {
    ...DEFAULTS,
    vehicleId: vehicleId ?? "",
    type: defaultType ?? DEFAULTS.type,
    title: defaultType ? TITLE_FOR_TYPE[defaultType] : DEFAULTS.title,
    priority: defaultType ? PRIORITY_FOR_TYPE[defaultType] : DEFAULTS.priority,
  };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });

  async function onSubmit(values: Values) {
    await create.mutateAsync({
      vehicleId: values.vehicleId,
      type: values.type,
      priority: values.priority,
      title: values.title,
      description: values.description || undefined,
      estimatedHours: values.estimatedHours || undefined,
      estimatedCost: values.estimatedCost || undefined,
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
      <SheetContent side="right" className="w-full sm:max-w-[560px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-xl">New work order</SheetTitle>
          <SheetDescription>Create a maintenance task for a vehicle.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <FormGrid cols={2}>
                {!vehicleId && (
                  <FormField
                    control={form.control}
                    name="vehicleId"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
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
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {humanize(p)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Description</FormLabel>
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
                <FormField
                  control={form.control}
                  name="estimatedHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated hours</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.5" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimatedCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated cost (A$)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {create.error && (
                  <FormGridRow>
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {create.error.message}
                    </div>
                  </FormGridRow>
                )}
              </FormGrid>
            </div>
            <div className="border-t px-6 py-4 shrink-0">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {create.isPending ? "Creating…" : "Create work order"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
