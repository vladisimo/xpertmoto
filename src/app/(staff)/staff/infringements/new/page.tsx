"use client";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/lib/trpc/client";
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
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";

const TYPES = ["SPEEDING", "PARKING", "TOLL", "RED_LIGHT", "OTHER"] as const;

const schema = z.object({
  vehicleId: z.string().min(1, "Required"),
  type: z.enum(TYPES),
  issuer: z.string().min(1, "Required"),
  referenceNumber: z.string().min(1, "Required"),
  offenceDate: z.string().min(1, "Required"),
  amount: z.coerce.number().min(0),
  dueDate: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function NewInfringementPage() {
  const router = useRouter();
  const { data: vehicles } = trpc.vehicle.list.useQuery({ take: 200 });
  const create = trpc.fleet.createInfringement.useMutation();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      vehicleId: "",
      type: "SPEEDING",
      issuer: "",
      referenceNumber: "",
      offenceDate: new Date().toISOString().slice(0, 10),
      amount: 0,
      dueDate: "",
    },
  });

  async function onSubmit(values: Values) {
    await create.mutateAsync({
      vehicleId: values.vehicleId,
      type: values.type,
      issuer: values.issuer,
      referenceNumber: values.referenceNumber,
      offenceDate: new Date(values.offenceDate),
      amount: values.amount,
      dueDate: values.dueDate ? new Date(values.dueDate) : undefined,
    });
    router.push("/staff/fleet/infringements");
  }

  return (
    <PageShell className="max-w-2xl">
      <PageHeader
        breadcrumbs={[
          { label: "Infringements", href: "/staff/fleet/infringements" },
          { label: "Record infringement" },
        ]}
        title="Record infringement"
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <PageSection title="Details">
            <FormGrid cols={2}>
              <FormField
                control={form.control}
                name="vehicleId"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Vehicle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {vehicles?.items.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{v.internalCode} · {v.rego}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</SelectItem>
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
                    <FormControl><Input placeholder="QLD Transport" {...field} /></FormControl>
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
                    <FormControl><Input {...field} /></FormControl>
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
                    <FormControl><Input type="number" {...field} /></FormControl>
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
                    <FormControl><Input type="date" {...field} /></FormControl>
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
                    <FormControl><Input type="date" {...field} /></FormControl>
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
              <FormGridRow className="flex justify-end">
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Saving…" : "Save infringement"}
                </Button>
              </FormGridRow>
            </FormGrid>
          </PageSection>
        </form>
      </Form>
    </PageShell>
  );
}
