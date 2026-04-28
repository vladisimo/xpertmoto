"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
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
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  LICENCE_REQUIREMENTS,
  ONLINE_PAYMENT_STRATEGIES,
  BILLING_FREQUENCIES,
  categoryFormSchema,
  type CategoryFormInput,
} from "@/lib/validators/category";

const LICENCE_HELP: Record<(typeof LICENCE_REQUIREMENTS)[number], string> = {
  CAR: "Car licence — covers 50cc scooters in QLD and full car hire.",
  RE: "Learner/restricted motorcycle licence — scooters up to ~260cc.",
  R: "Open motorcycle licence — any engine size.",
};

const STRATEGY_HELP: Record<(typeof ONLINE_PAYMENT_STRATEGIES)[number], string> = {
  FULL: "Charge 100% of the rental online at booking time. No remainder at pickup.",
  FLAT: "Charge a flat booking fee (AUD) online. The rest is collected at pickup.",
  PERCENT: "Charge a deposit percentage of the total online. The rest is collected at pickup.",
  ZERO: "Collect nothing online. Customer pays everything at pickup. Bond is still authorised.",
};

const FREQUENCY_LABEL: Record<(typeof BILLING_FREQUENCIES)[number], string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type CategoryRow = CategoryFormInput & { id: string; isActive?: boolean };

export function CategoryFormSheet({
  mode,
  initial,
  onClose,
}: {
  mode: "create" | "edit";
  initial?: CategoryRow;
  onClose: () => void;
}) {
  const util = trpc.useUtils();
  const invalidate = () => util.admin.listAllCategories.invalidate();

  const create = trpc.admin.createCategory.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const update = trpc.admin.updateCategory.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const form = useForm<CategoryFormInput>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: initial ?? {
      name: "",
      slug: "",
      description: "",
      engineCapacity: 50,
      licenceRequired: "CAR",
      minAge: 18,
      displayOrder: 0,
      baseDailyRate: 0,
      baseWeeklyRate: 0,
      baseMonthlyRate: 0,
      bondAmount: 0,
      images: [],
      onlinePaymentStrategy: "FULL",
      bookingFeeFlat: null,
      bookingFeePercent: null,
      longTermMinDays: 14,
      longTermDefaultFrequency: "WEEKLY",
    },
  });

  const strategy = form.watch("onlinePaymentStrategy");

  // Keep slug in lockstep with name when creating; stop syncing once the
  // user edits either the slug or the form is in edit mode.
  const watchedName = form.watch("name");
  const slugDirty = form.formState.dirtyFields.slug;
  useEffect(() => {
    if (mode === "create" && !slugDirty && watchedName) {
      form.setValue("slug", slugify(watchedName), { shouldValidate: false });
    }
  }, [watchedName, slugDirty, mode, form]);

  function onSubmit(values: CategoryFormInput) {
    if (mode === "create") {
      create.mutate(values);
    } else if (initial) {
      update.mutate({ id: initial.id, ...values });
    }
  }

  const pending = create.isPending || update.isPending;
  const error = create.error?.message ?? update.error?.message;

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle>{mode === "create" ? "New category" : `Edit ${initial?.name ?? "category"}`}</SheetTitle>
        <p className="text-sm text-muted-foreground">
          {mode === "create"
            ? "Define a new vehicle category. Only CAR, RE and R licence classes are supported today."
            : "Update the category metadata. Use the Pricing page to change base rates."}
        </p>
      </SheetHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6">
          <FormGrid cols={2}>
            <FormGridRow>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 150cc Scooter" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGridRow>
            <FormGridRow>
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL slug</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 150cc-scooter" {...field} />
                    </FormControl>
                    <FormDescription>
                      Auto-generated from the name. Only lowercase letters, numbers and hyphens.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGridRow>
            <FormGridRow>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <textarea
                        rows={3}
                        placeholder="Public-facing blurb shown on /fleet."
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGridRow>
            <FormField
              control={form.control}
              name="engineCapacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Engine capacity (cc)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>A 1.5L car is 1500cc.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="licenceRequired"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Licence required</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LICENCE_REQUIREMENTS.map((l) => (
                        <SelectItem key={l} value={l}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{LICENCE_HELP[field.value]}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="minAge"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimum rider age</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={16}
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="displayOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display order</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription>Lower numbers appear first on /fleet.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baseDailyRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Daily rate (A$)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baseWeeklyRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Weekly rate (A$)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baseMonthlyRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly rate (A$)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bondAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bond (A$)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      {...field}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormGridRow>
              <div className="rounded-md border bg-muted/30 p-4 space-y-4">
                <div>
                  <h3 className="h3">Online payment</h3>
                  <p className="caption">
                    How much the customer pays during the booking wizard. The bond is always authorised online regardless.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="onlinePaymentStrategy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Strategy</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ONLINE_PAYMENT_STRATEGIES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>{STRATEGY_HELP[field.value]}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {strategy === "FLAT" && (
                  <FormField
                    control={form.control}
                    name="bookingFeeFlat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Flat booking fee (A$, GST incl.)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {strategy === "PERCENT" && (
                  <FormField
                    control={form.control}
                    name="bookingFeePercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deposit percentage (0–100)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </FormGridRow>

            <FormGridRow>
              <div className="rounded-md border bg-muted/30 p-4 space-y-4">
                <div>
                  <h3 className="h3">Long-term hires</h3>
                  <p className="caption">
                    When a booking runs this long or longer, the first period + bond are charged online and the recurring periods are billed automatically to the customer&apos;s card on file.
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="longTermMinDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min days for long-term (blank = disabled)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="longTermDefaultFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing frequency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BILLING_FREQUENCIES.map((f) => (
                            <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </FormGridRow>

            <FormGridRow>
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Saving…" : mode === "create" ? "Create category" : "Save changes"}
              </Button>
            </FormGridRow>
            {error && (
              <FormGridRow>
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              </FormGridRow>
            )}
          </FormGrid>
        </form>
      </Form>
    </>
  );
}
