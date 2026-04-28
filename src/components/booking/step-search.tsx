"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useBookingWizard } from "@/stores/booking-wizard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { BookingDateRangePicker } from "@/components/booking/date-range-picker";
import { searchStepSchema, type SearchStepValues } from "@/lib/validators/booking";
import { validateBookingTimes } from "@/lib/validators/booking-times";
import { trackEvent } from "@/lib/analytics/track";
import { useStepContinueAction } from "@/hooks/use-step-continue-action";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";

export function StepSearch() {
  const w = useBookingWizard();
  const layout = useWizardShellLayout();
  const { data: depots } = trpc.depot.list.useQuery();
  const { data: categories } = trpc.vehicle.listCategories.useQuery();

  const form = useForm<SearchStepValues>({
    resolver: zodResolver(searchStepSchema),
    mode: "onBlur",
    defaultValues: {
      pickupDepotId: w.pickupDepotId ?? "",
      returnDepotId: w.returnDepotId ?? "",
      pickupDateTime: w.pickupDateTime ?? "",
      returnDateTime: w.returnDateTime ?? "",
      categoryId: w.categoryId ?? "",
    },
  });

  const pickupDepotId = form.watch("pickupDepotId");
  const returnDepotId = form.watch("returnDepotId");
  const pickupDepot = depots?.find((d) => d.id === pickupDepotId) ?? null;
  const returnDepot = depots?.find((d) => d.id === returnDepotId) ?? null;
  // Most hires are round-trip — collapse the return depot picker by
  // default and mirror it to whatever the customer picks for pickup. The
  // "Return to a different depot" link below reveals it. With only one
  // depot configured the return picker is hidden entirely; the auto-
  // mirror still keeps the form valid.
  const showReturnDepot = (depots?.length ?? 0) > 1;
  const [returnDifferent, setReturnDifferent] = useState(
    () => !!w.pickupDepotId && !!w.returnDepotId && w.pickupDepotId !== w.returnDepotId,
  );

  // Mirror returnDepotId ← pickupDepotId whenever the customer hasn't
  // explicitly chosen a different return depot. Runs after every pickup
  // change so changing the pickup updates the implicit return.
  useEffect(() => {
    if (returnDifferent) return;
    if (!pickupDepotId) return;
    if (form.getValues("returnDepotId") !== pickupDepotId) {
      form.setValue("returnDepotId", pickupDepotId, { shouldValidate: false });
    }
  }, [pickupDepotId, returnDifferent, form]);

  // Sync form state → Zustand so partial progress is persisted across reloads.
  useEffect(() => {
    const sub = form.watch((values) => {
      w.set("pickupDepotId", values.pickupDepotId || null);
      w.set("returnDepotId", values.returnDepotId || null);
      w.set("pickupDateTime", values.pickupDateTime || null);
      w.set("returnDateTime", values.returnDateTime || null);
      w.set("categoryId", values.categoryId || null);
    });
    return () => sub.unsubscribe();
  }, [form, w]);

  // Single-depot deployments: pre-select it so the user doesn't have to
  // tap through a one-option dropdown.
  useEffect(() => {
    if (!depots || depots.length !== 1) return;
    const only = depots[0]!.id;
    if (!form.getValues("pickupDepotId")) {
      form.setValue("pickupDepotId", only, { shouldValidate: false });
    }
    if (!form.getValues("returnDepotId")) {
      form.setValue("returnDepotId", only, { shouldValidate: false });
    }
  }, [depots, form]);

  function onSubmit(values: SearchStepValues) {
    const pickupDepot = depots?.find((d) => d.id === values.pickupDepotId);
    const returnDepot = depots?.find((d) => d.id === values.returnDepotId);
    if (pickupDepot && returnDepot) {
      const check = validateBookingTimes({
        pickupDateTime: new Date(values.pickupDateTime),
        returnDateTime: new Date(values.returnDateTime),
        pickupDepot: {
          name: pickupDepot.name,
          timezone: pickupDepot.timezone,
          operatingHours: pickupDepot.operatingHours,
        },
        returnDepot: {
          name: returnDepot.name,
          timezone: returnDepot.timezone,
          operatingHours: returnDepot.operatingHours,
        },
      });
      if (!check.ok) {
        form.setError(check.field, { type: "manual", message: check.message });
        return;
      }
    }
    // Search event — sanitizer strips any PII-ish values, but dates +
    // categoryId + depotIds are safe by construction.
    trackEvent({
      kind: "SEARCH",
      target: "booking-wizard-search",
      value: [
        values.pickupDepotId,
        values.returnDepotId,
        values.pickupDateTime,
        values.returnDateTime,
        values.categoryId,
      ]
        .filter(Boolean)
        .join(" · "),
    });
    w.next();
  }

  useStepContinueAction({
    label: "Continue",
    disabled: false,
    pending: form.formState.isSubmitting,
    // Trigger react-hook-form's own validation path; on success it calls
    // onSubmit which advances the wizard. Errors stay inline as normal.
    onClick: () => form.handleSubmit(onSubmit)(),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Render the heading only on desktop. The previous `hidden md:block`
         * still counted as a preceding sibling of the grid, so Tailwind's
         * `space-y-*` rule pushed the grid down by 24px on mobile. Removing
         * it from the mobile DOM tightens the gap above "Pickup depot". */}
        {layout === "desktop" && <h2 className="h2">When & where?</h2>}
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          {showReturnDepot && (
            <FormField
              control={form.control}
              name="pickupDepotId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pickup depot</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select depot…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {depots?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {showReturnDepot && (
            returnDifferent ? (
              <FormField
                control={form.control}
                name="returnDepotId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Return depot</FormLabel>
                      <button
                        type="button"
                        onClick={() => {
                          if (pickupDepotId) {
                            form.setValue("returnDepotId", pickupDepotId, {
                              shouldValidate: false,
                            });
                          }
                          setReturnDifferent(false);
                        }}
                        className="caption text-primary underline-offset-2 hover:underline"
                      >
                        Use same as pickup
                      </button>
                    </div>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select depot…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {depots?.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              // Placeholder cell when the customer hasn't expanded the return
              // dropdown — keeps pickup + return on one row at all times.
              // Tap it (anywhere in the cell) to switch into a real return-depot
              // dropdown. Styled to match a SelectTrigger for visual rhythm.
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Return depot</label>
                <button
                  type="button"
                  onClick={() => setReturnDifferent(true)}
                  className={cn(
                    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
                    "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="truncate">Same as pickup</span>
                  <span className="ml-2 shrink-0 caption text-primary underline-offset-2">
                    Change
                  </span>
                </button>
              </div>
            )
          )}
          <FormField
            control={form.control}
            name="pickupDateTime"
            render={({ field: pickupField, fieldState: pickupState }) => (
              <FormField
                control={form.control}
                name="returnDateTime"
                render={({ field: returnField, fieldState: returnState }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Pickup &amp; return dates</FormLabel>
                    <FormControl>
                      <BookingDateRangePicker
                        pickupValue={pickupField.value}
                        returnValue={returnField.value}
                        onPickupChange={pickupField.onChange}
                        onReturnChange={returnField.onChange}
                        onPickupBlur={pickupField.onBlur}
                        onReturnBlur={returnField.onBlur}
                        pickupDepot={pickupDepot}
                        returnDepot={returnDepot}
                        pickupAriaInvalid={Boolean(pickupState.error)}
                        returnAriaInvalid={Boolean(returnState.error)}
                      />
                    </FormControl>
                    {pickupState.error && (
                      <FormMessage>{pickupState.error.message}</FormMessage>
                    )}
                    {returnState.error && (
                      <FormMessage>{returnState.error.message}</FormMessage>
                    )}
                  </FormItem>
                )}
              />
            )}
          />
          <FormField
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <div className="flex items-center gap-3">
                  <FormLabel className="w-24 shrink-0">Vehicle category</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl className="flex-1 min-w-0">
                      <SelectTrigger>
                        <SelectValue placeholder="Any / select a category…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} — from A${Number(c.baseDailyRate).toFixed(0)}/day
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <FormMessage className="ml-[6.75rem]" />
              </FormItem>
            )}
          />
        </div>
        {form.formState.submitCount > 0 && !form.formState.isValid && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Please fix the highlighted fields above before continuing.
          </div>
        )}
        {layout === "desktop" && (
          <div className="flex justify-end">
            <Button type="submit">Continue</Button>
          </div>
        )}
      </form>
    </Form>
  );
}

