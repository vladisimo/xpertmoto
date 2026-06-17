"use client";

import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
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
import { PageSection } from "@/components/layout/page-section";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";

const INFRINGEMENT_TYPES = ["SPEEDING", "PARKING", "TOLL", "RED_LIGHT", "OTHER"] as const;
const INCIDENT_TYPES = [
  "ACCIDENT",
  "THEFT",
  "VANDALISM",
  "BREAKDOWN",
  "CUSTOMER_DAMAGE",
  "WEATHER",
  "INFRINGEMENT",
  "OTHER",
] as const;
const INCIDENT_SEVERITIES = ["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"] as const;

function humanise(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ResultBanner({ message }: { message: string | null }): React.ReactNode {
  if (!message) return null;
  return (
    <FormGridRow>
      <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
        {message}
      </div>
    </FormGridRow>
  );
}

function ErrorBanner({ message }: { message: string | null | undefined }): React.ReactNode {
  if (!message) return null;
  return (
    <FormGridRow>
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        {message}
      </div>
    </FormGridRow>
  );
}

/** Vehicle picker that shares the same shape everywhere. */
function VehicleSelect<
  T extends { vehicleId: string },
>({ form }: { form: UseFormReturn<T> }): React.ReactNode {
  const { data: vehicles } = trpc.vehicle.list.useQuery({ take: 200 });
  return (
    <FormField
      control={form.control}
      // @ts-expect-error — generic constrains the shape; runtime key is literal.
      name="vehicleId"
      render={({ field }) => (
        <FormItem className="md:col-span-2">
          <FormLabel>Vehicle</FormLabel>
          <Select onValueChange={field.onChange} value={field.value as string}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select vehicle" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {vehicles?.items.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.internalCode} · {v.rego} · {v.make} {v.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/**
 * Shows the booking that will be auto-linked to the injection, given a
 * vehicle + time. Queries only once both fields have values.
 */
function ResolvedBookingPreview({
  vehicleId,
  at,
}: {
  vehicleId: string;
  at: Date | null;
}): React.ReactNode {
  const enabled = Boolean(vehicleId) && Boolean(at);
  const { data, isFetching } = trpc.devTools.resolveActiveBooking.useQuery(
    { vehicleId, at: at ?? new Date() },
    { enabled },
  );
  if (!enabled) return null;
  return (
    <FormGridRow>
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <div className="text-caption text-muted-foreground">Resolved booking</div>
        {isFetching ? (
          <div className="text-muted-foreground">Resolving…</div>
        ) : data ? (
          <div>
            <span className="font-medium">{data.bookingReference}</span>{" "}
            <span className="text-muted-foreground">
              · {data.status} · {data.customer.firstName} {data.customer.lastName}
            </span>
          </div>
        ) : (
          <div className="text-muted-foreground">
            No booking active on this vehicle at the selected time — the event
            will be recorded against the vehicle only.
          </div>
        )}
      </div>
    </FormGridRow>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Toll event                                                      */
/* ------------------------------------------------------------------ */

const tollSchema = z.object({
  vehicleId: z.string().min(1, "Required"),
  eventAt: z.string().min(1, "Required"),
  amount: z.coerce.number().min(0.01),
  tollpoint: z.string().optional(),
});
type TollValues = z.infer<typeof tollSchema>;

function TollInjector(): React.ReactNode {
  const [lastInjected, setLastInjected] = useState<string | null>(null);
  const create = trpc.devTools.injectToll.useMutation();
  const form = useForm<TollValues>({
    resolver: zodResolver(tollSchema),
    defaultValues: {
      vehicleId: "",
      eventAt: toLocalDatetimeValue(new Date()),
      amount: 4.5,
      tollpoint: "",
    },
  });

  async function onSubmit(values: TollValues): Promise<void> {
    const row = await create.mutateAsync({
      vehicleId: values.vehicleId,
      eventAt: new Date(values.eventAt),
      amountCents: Math.round(values.amount * 100),
      tollpoint: values.tollpoint || undefined,
    });
    const tail = `(${row.externalHash.slice(0, 16)}…)`;
    const message =
      row.result === "created"
        ? `Toll auto-matched to active booking ${tail} — see /staff/fleet/infringements.`
        : row.result === "unmatched"
          ? `Toll recorded as unmatched ${tail} — resolve it on /staff/tolls.`
          : `Toll already exists ${tail} — no change.`;
    setLastInjected(message);
  }

  return (
    <PageSection
      title="Inject toll event"
      description="Routes through the production matching pipeline: auto-matches if a booking is active for the vehicle at the event time, otherwise lands on /staff/tolls for manual resolve."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormGrid cols={2}>
            <VehicleSelect form={form} />
            <FormField
              control={form.control}
              name="eventAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
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
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tollpoint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Toll point (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Eastern Distributor" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ErrorBanner message={create.error?.message} />
            <ResultBanner message={lastInjected} />
            <FormGridRow className="flex justify-end">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Injecting…" : "Inject toll"}
              </Button>
            </FormGridRow>
          </FormGrid>
        </form>
      </Form>
    </PageSection>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Infringement                                                    */
/* ------------------------------------------------------------------ */

const infringementSchema = z.object({
  vehicleId: z.string().min(1, "Required"),
  type: z.enum(INFRINGEMENT_TYPES),
  issuer: z.string().min(1, "Required"),
  referenceNumber: z.string().min(1, "Required"),
  offenceDate: z.string().min(1, "Required"),
  amount: z.coerce.number().min(0),
  dueDate: z.string().optional(),
});
type InfringementValues = z.infer<typeof infringementSchema>;

function InfringementInjector(): React.ReactNode {
  const [lastInjected, setLastInjected] = useState<string | null>(null);
  const create = trpc.devTools.injectInfringement.useMutation();
  const form = useForm<InfringementValues>({
    resolver: zodResolver(infringementSchema),
    defaultValues: {
      vehicleId: "",
      type: "SPEEDING",
      issuer: "QLD Transport",
      referenceNumber: `TEST-${Date.now().toString().slice(-6)}`,
      offenceDate: toLocalDatetimeValue(new Date()),
      amount: 280,
      dueDate: "",
    },
  });

  const vehicleId = form.watch("vehicleId");
  const offenceAt = form.watch("offenceDate");
  const offenceDate = offenceAt ? new Date(offenceAt) : null;

  async function onSubmit(values: InfringementValues): Promise<void> {
    const inf = await create.mutateAsync({
      vehicleId: values.vehicleId,
      type: values.type,
      issuer: values.issuer,
      referenceNumber: values.referenceNumber,
      offenceDate: new Date(values.offenceDate),
      amount: values.amount,
      dueDate: values.dueDate ? new Date(values.dueDate) : undefined,
    });
    setLastInjected(
      `Infringement ${inf.referenceNumber} created${inf.bookingId ? ` (linked to booking)` : " (no active booking — vehicle only)"}. View on /staff/fleet/infringements.`,
    );
  }

  return (
    <PageSection
      title="Inject infringement"
      description="Creates an Infringement auto-linked to the booking active on the vehicle at the offence time. Exercises the nominate → customer-charge flow."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormGrid cols={2}>
            <VehicleSelect form={form} />
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
                      {INFRINGEMENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {humanise(t)}
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
                    <Input type="number" step="0.01" {...field} />
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
                  <FormLabel>Offence time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
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
                  <FormLabel>Due date (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ResolvedBookingPreview vehicleId={vehicleId} at={offenceDate} />
            <ErrorBanner message={create.error?.message} />
            <ResultBanner message={lastInjected} />
            <FormGridRow className="flex justify-end">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Injecting…" : "Inject infringement"}
              </Button>
            </FormGridRow>
          </FormGrid>
        </form>
      </Form>
    </PageSection>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Incident                                                        */
/* ------------------------------------------------------------------ */

const incidentSchema = z.object({
  vehicleId: z.string().min(1, "Required"),
  dateTime: z.string().min(1, "Required"),
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  description: z.string().min(1, "Required"),
  estimatedDamageCost: z.coerce.number().min(0).optional(),
});
type IncidentValues = z.infer<typeof incidentSchema>;

function IncidentInjector(): React.ReactNode {
  const [lastInjected, setLastInjected] = useState<string | null>(null);
  const create = trpc.devTools.injectIncident.useMutation();
  const form = useForm<IncidentValues>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      vehicleId: "",
      dateTime: toLocalDatetimeValue(new Date()),
      type: "CUSTOMER_DAMAGE",
      severity: "MINOR",
      description: "Test-injected incident for workflow rehearsal.",
      estimatedDamageCost: 150,
    },
  });

  const vehicleId = form.watch("vehicleId");
  const at = form.watch("dateTime");
  const atDate = at ? new Date(at) : null;

  async function onSubmit(values: IncidentValues): Promise<void> {
    const inc = await create.mutateAsync({
      vehicleId: values.vehicleId,
      dateTime: new Date(values.dateTime),
      type: values.type,
      severity: values.severity,
      description: values.description,
      estimatedDamageCost: values.estimatedDamageCost,
    });
    setLastInjected(
      `Incident ${inc.incidentNumber} created${inc.bookingId ? " (linked to booking)" : ""}.`,
    );
  }

  return (
    <PageSection
      title="Inject incident"
      description="Creates an Incident auto-linked to the booking active on the vehicle at the event time. Tests the incident dashboard & damage-charge flow."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormGrid cols={2}>
            <VehicleSelect form={form} />
            <FormField
              control={form.control}
              name="dateTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
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
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {INCIDENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {humanise(t)}
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
                      {INCIDENT_SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {humanise(s)}
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
              name="estimatedDamageCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated damage (A$)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
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
                      rows={3}
                      className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ResolvedBookingPreview vehicleId={vehicleId} at={atDate} />
            <ErrorBanner message={create.error?.message} />
            <ResultBanner message={lastInjected} />
            <FormGridRow className="flex justify-end">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Injecting…" : "Inject incident"}
              </Button>
            </FormGridRow>
          </FormGrid>
        </form>
      </Form>
    </PageSection>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Force booking overdue                                           */
/* ------------------------------------------------------------------ */

const overdueSchema = z.object({
  bookingId: z.string().min(1, "Required"),
  minutesLate: z.coerce.number().int().min(61).max(60 * 24 * 14),
});
type OverdueValues = z.infer<typeof overdueSchema>;

function OverdueInjector(): React.ReactNode {
  const [lastInjected, setLastInjected] = useState<string | null>(null);
  const { data: bookings } = trpc.devTools.listForceableBookings.useQuery();
  const force = trpc.devTools.forceBookingOverdue.useMutation();
  const form = useForm<OverdueValues>({
    resolver: zodResolver(overdueSchema),
    defaultValues: { bookingId: "", minutesLate: 90 },
  });

  async function onSubmit(values: OverdueValues): Promise<void> {
    const { booking, overdueRun } = await force.mutateAsync(values);
    setLastInjected(
      `Booking ${booking.bookingReference} is now ${booking.status} (stage ${booking.overdueStage}). ` +
        `Overdue job scanned ${overdueRun.scanned} bookings and transitioned ${overdueRun.transitionedToOverdue}.`,
    );
  }

  return (
    <PageSection
      title="Force booking overdue"
      description="Back-dates returnDateTime and runs the overdue-check job immediately. Stage thresholds: 61m → OVERDUE, 720m → second SMS nudge, 1440m → manager escalation, 4320m → auto-incident."
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormGrid cols={2}>
            <FormField
              control={form.control}
              name="bookingId"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Booking</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select active booking" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {bookings?.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.bookingReference} · {b.vehicle?.internalCode ?? "?"} ·{" "}
                          {b.customer.firstName} {b.customer.lastName} · due{" "}
                          {b.returnDateTime.toLocaleString("en-AU", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
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
              name="minutesLate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Minutes past return</FormLabel>
                  <FormControl>
                    <Input type="number" min={61} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ErrorBanner message={force.error?.message} />
            <ResultBanner message={lastInjected} />
            <FormGridRow className="flex justify-end">
              <Button type="submit" disabled={force.isPending}>
                {force.isPending ? "Forcing…" : "Force overdue"}
              </Button>
            </FormGridRow>
          </FormGrid>
        </form>
      </Form>
    </PageSection>
  );
}

/* ------------------------------------------------------------------ */

export function TestDataInjectorPanel(): React.ReactNode {
  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground">
        <div className="font-medium">Dev / staging only</div>
        <p className="mt-1 text-muted-foreground">
          These tools create real database records. Every injection is recorded
          in the audit log with your user id. The tab and backend procedures are
          completely disabled in production.
        </p>
      </div>
      <TollInjector />
      <InfringementInjector />
      <IncidentInjector />
      <OverdueInjector />
    </div>
  );
}
