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
  "ACCIDENT",
  "THEFT",
  "VANDALISM",
  "BREAKDOWN",
  "CUSTOMER_DAMAGE",
  "WEATHER",
  "INFRINGEMENT",
  "OTHER",
] as const;
const SEVERITIES = ["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"] as const;

const schema = z.object({
  vehicleId: z.string().min(1, "Required"),
  type: z.enum(TYPES),
  severity: z.enum(SEVERITIES),
  dateTime: z.string().min(1, "Required"),
  location: z.string().optional(),
  description: z.string().min(1, "Required"),
  estimatedDamageCost: z.coerce.number().min(0).optional(),
  customerLiable: z.boolean().default(false),
  customerChargeAmount: z.coerce.number().min(0).optional(),
});
type Values = z.infer<typeof schema>;

function defaults(): Values {
  return {
    vehicleId: "",
    type: "ACCIDENT",
    severity: "MINOR",
    dateTime: new Date().toISOString().slice(0, 16),
    location: "",
    description: "",
    estimatedDamageCost: 0,
    customerLiable: false,
    customerChargeAmount: 0,
  };
}

function humanize(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function IncidentSheet({
  open,
  onOpenChange,
  vehicleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId?: string;
}) {
  const router = useRouter();
  const { data: vehicles } = trpc.vehicle.list.useQuery({ take: 200 }, { enabled: !vehicleId });
  const create = trpc.fleet.createIncident.useMutation();

  const initial = (): Values => ({ ...defaults(), vehicleId: vehicleId ?? "" });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial() });
  const customerLiable = form.watch("customerLiable");

  async function onSubmit(values: Values) {
    await create.mutateAsync({
      vehicleId: values.vehicleId,
      type: values.type,
      severity: values.severity,
      dateTime: new Date(values.dateTime),
      location: values.location || undefined,
      description: values.description,
      estimatedDamageCost: values.estimatedDamageCost || undefined,
      customerLiable: values.customerLiable,
      customerChargeAmount: values.customerLiable
        ? values.customerChargeAmount || undefined
        : undefined,
    });
    form.reset(initial());
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) form.reset(initial());
        onOpenChange(v);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-[560px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-xl">Report incident</SheetTitle>
          <SheetDescription>Log an accident, theft, damage, or breakdown.</SheetDescription>
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
                  name="severity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Severity</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SEVERITIES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {humanize(s)}
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
                  name="dateTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date &amp; time</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="Intersection, suburb…" {...field} />
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
                          className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimatedDamageCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated damage (A$)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="customerLiable"
                  render={({ field }) => (
                    <FormItem className="flex items-end gap-2">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                          className="h-4 w-4 rounded border-input"
                          id="liable"
                        />
                      </FormControl>
                      <FormLabel htmlFor="liable" className="pb-0.5">
                        Customer liable
                      </FormLabel>
                    </FormItem>
                  )}
                />
                {customerLiable && (
                  <FormField
                    control={form.control}
                    name="customerChargeAmount"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Customer charge (A$)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
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
                {create.isPending ? "Saving…" : "Report incident"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
