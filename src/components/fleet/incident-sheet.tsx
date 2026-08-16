"use client";

import { useEffect } from "react";
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

/** Sentinel for the explicit "no linked booking" choice in the select. */
const NO_BOOKING = "NONE";

/** Stable placeholder for the disabled candidate query (a fresh `new Date()`
 *  per render would churn the TanStack query key). */
const EPOCH = new Date(0);

const schema = z.object({
  vehicleId: z.string().min(1, "Required"),
  bookingId: z.string().optional(),
  type: z.enum(TYPES),
  severity: z.enum(SEVERITIES),
  dateTime: z.string().min(1, "Required"),
  location: z.string().optional(),
  description: z.string().min(1, "Required"),
  estimatedDamageCost: z.coerce.number().min(0).optional(),
  customerLiable: z.boolean().default(false),
  customerChargeAmount: z.coerce.number().min(0).optional(),
  policeReportNumber: z.string().optional(),
  insuranceClaimNumber: z.string().optional(),
});
type Values = z.infer<typeof schema>;

function toLocalInputValue(d: Date): string {
  // `<input type="datetime-local">` expects a naive LOCAL "YYYY-MM-DDTHH:mm".
  // `toISOString()` is UTC — in Brisbane that defaults the occurrence time 10
  // hours into the past, which can make the swap-aware booking matcher
  // auto-link the PREVIOUS renter as the liable customer.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaults(): Values {
  return {
    vehicleId: "",
    bookingId: "",
    type: "ACCIDENT",
    severity: "MINOR",
    dateTime: toLocalInputValue(new Date()),
    location: "",
    description: "",
    estimatedDamageCost: 0,
    customerLiable: false,
    customerChargeAmount: 0,
    policeReportNumber: "",
    insuranceClaimNumber: "",
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
  const incidentType = form.watch("type");
  // Police report / insurance claim references only make sense for events
  // with an external paper trail; other types add them later via the
  // incident detail page if one materialises.
  const showClaimFields = incidentType === "THEFT" || incidentType === "ACCIDENT";

  // Booking linkage (Area 5): once the vehicle + occurrence time are known,
  // ask the swap-aware matcher who held the vehicle then and offer the
  // candidates in a select. A manual pick that disagrees with the matcher
  // warns but never blocks.
  const watchedVehicleId = form.watch("vehicleId");
  const watchedDateTime = form.watch("dateTime");
  const occurredAt =
    watchedDateTime && !Number.isNaN(Date.parse(watchedDateTime))
      ? new Date(watchedDateTime)
      : null;
  const { data: candidates } = trpc.fleet.candidateBookingsForIncident.useQuery(
    { vehicleId: watchedVehicleId, at: occurredAt ?? EPOCH },
    { enabled: !!watchedVehicleId && !!occurredAt },
  );
  const selectedBookingId = form.watch("bookingId") ?? "";
  const singleMatch =
    candidates && candidates.length === 1 && candidates[0]?.confidence === "match"
      ? candidates[0]
      : null;
  useEffect(() => {
    // Auto-suggest: pre-select an unambiguous match while the field is
    // untouched; clear a stale pick when the candidate list changes under it.
    const current = form.getValues("bookingId") ?? "";
    const inList = (id: string) => (candidates ?? []).some((c) => c.bookingId === id);
    if (current && current !== NO_BOOKING && !inList(current)) {
      form.setValue("bookingId", "");
    } else if (!current && singleMatch) {
      form.setValue("bookingId", singleMatch.bookingId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);
  const mismatchWarning =
    candidates && candidates.length > 0
      ? selectedBookingId === NO_BOOKING
        ? `The matcher attributes this vehicle at that time to ${candidates
            .map((c) => c.bookingReference)
            .join(", ")} — double-check before reporting without a booking.`
        : singleMatch && selectedBookingId && selectedBookingId !== singleMatch.bookingId
          ? `The matcher suggests ${singleMatch.bookingReference} (${singleMatch.customerName}) held this vehicle at that time.`
          : null
      : null;

  async function onSubmit(values: Values) {
    const linkedBookingId =
      values.bookingId && values.bookingId !== NO_BOOKING ? values.bookingId : undefined;
    const linkedCustomerId = linkedBookingId
      ? (candidates ?? []).find((c) => c.bookingId === linkedBookingId)?.customerId
      : undefined;
    await create.mutateAsync({
      vehicleId: values.vehicleId,
      bookingId: linkedBookingId,
      customerId: linkedCustomerId,
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
      policeReportNumber: showClaimFields
        ? values.policeReportNumber?.trim() || undefined
        : undefined,
      insuranceClaimNumber: showClaimFields
        ? values.insuranceClaimNumber?.trim() || undefined
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
                {watchedVehicleId && occurredAt && (
                  <FormField
                    control={form.control}
                    name="bookingId"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Linked booking</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select booking…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(candidates ?? []).map((c) => (
                              <SelectItem key={c.bookingId} value={c.bookingId}>
                                {c.bookingReference} · {c.customerName}
                                {c.confidence === "match" ? " (suggested)" : ""}
                              </SelectItem>
                            ))}
                            <SelectItem value={NO_BOOKING}>No linked booking</SelectItem>
                          </SelectContent>
                        </Select>
                        {candidates && candidates.length > 1 && (
                          <p className="text-xs text-muted-foreground">
                            Multiple bookings overlap this vehicle at that time — pick
                            deliberately.
                          </p>
                        )}
                        {candidates && candidates.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No booking held this vehicle at that time.
                          </p>
                        )}
                        {mismatchWarning && (
                          <p className="caption rounded-md border border-border bg-muted p-2">
                            {mismatchWarning}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
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
                {showClaimFields && (
                  <>
                    <FormField
                      control={form.control}
                      name="policeReportNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Police report # (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Event / report number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="insuranceClaimNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Insurance claim # (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Insurer claim number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
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
