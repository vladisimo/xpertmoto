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
  "SPEEDING",
  "PARKING",
  "TOLL",
  "RED_LIGHT",
  "MOBILE_PHONE",
  "SEATBELT",
  "UNREGISTERED",
  "OTHER",
] as const;

const schema = z.object({
  vehicleId: z.string().min(1, "Required"),
  type: z.enum(TYPES),
  issuer: z.string().min(1, "Required"),
  referenceNumber: z.string().min(1, "Required"),
  offenceDate: z.string().min(1, "Required"),
  amount: z.coerce.number().min(0),
  dueDate: z.string().optional(),
  issueDate: z.string().optional(),
  offenceCode: z.string().optional(),
  offenceDescription: z.string().optional(),
  offenceLocation: z.string().optional(),
  demeritPoints: z.coerce.number().int().min(0).optional(),
});
type Values = z.infer<typeof schema>;

function defaults(): Values {
  return {
    vehicleId: "",
    type: "SPEEDING",
    issuer: "Revenue NSW",
    referenceNumber: "",
    offenceDate: new Date().toISOString().slice(0, 10),
    amount: 0,
    dueDate: "",
    issueDate: "",
    offenceCode: "",
    offenceDescription: "",
    offenceLocation: "",
    demeritPoints: 0,
  };
}

function humanize(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function InfringementSheet({
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
  const create = trpc.fleet.createInfringement.useMutation();

  const initial = (): Values => ({ ...defaults(), vehicleId: vehicleId ?? "" });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial() });

  async function onSubmit(values: Values) {
    await create.mutateAsync({
      vehicleId: values.vehicleId,
      type: values.type,
      issuer: values.issuer,
      referenceNumber: values.referenceNumber,
      offenceDate: new Date(values.offenceDate),
      amount: values.amount,
      dueDate: values.dueDate ? new Date(values.dueDate) : undefined,
      issueDate: values.issueDate ? new Date(values.issueDate) : undefined,
      offenceCode: values.offenceCode || undefined,
      offenceDescription: values.offenceDescription || undefined,
      offenceLocation: values.offenceLocation || undefined,
      demeritPoints: values.demeritPoints ?? 0,
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
          <SheetTitle className="text-xl">Record infringement</SheetTitle>
          <SheetDescription>Log a speeding, parking, toll, or other infringement.</SheetDescription>
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
                                {v.internalCode} · {v.rego}
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
                  name="issuer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Issuer</FormLabel>
                      <FormControl>
                        <Input placeholder="QLD Transport" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="referenceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reference #</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (A$)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="offenceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Offence date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="issueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notice issue date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="demeritPoints"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Demerit points</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="offenceCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Offence code</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="offenceLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Offence location</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="offenceDescription"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Offence description</FormLabel>
                      <FormControl>
                        <Input placeholder="Exceed speed limit by 10 km/h" {...field} />
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
                {create.isPending ? "Saving…" : "Save infringement"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
