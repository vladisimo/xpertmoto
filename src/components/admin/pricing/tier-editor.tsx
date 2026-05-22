"use client";

import { useEffect, useMemo } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Trash2 } from "lucide-react";
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
import { formatCurrency } from "@/lib/utils";
import {
  pricingTierReplaceInputSchema,
  type PricingTierScope,
} from "@/lib/validators/pricing-tier";

function scopeNoun(scope: PricingTierScope): string {
  switch (scope) {
    case "CATEGORY":
      return "category";
    case "MODEL":
      return "model";
    case "VEHICLE":
      return "vehicle";
  }
}

type FormValues = z.infer<typeof pricingTierReplaceInputSchema>;

export interface TierEditorProps {
  scope: PricingTierScope;
  scopeId: string;
  /** Short human label for the selected scope, shown in the header. */
  scopeLabel: string;
}

export function TierEditor({ scope, scopeId, scopeLabel }: TierEditorProps) {
  const util = trpc.useUtils();
  const invalidate = async () => {
    await Promise.all([
      util.admin.listPricingTiers.invalidate({ scope, scopeId }),
      util.admin.pricingSummary.invalidate(),
    ]);
  };

  const { data: existingTiers, isLoading } = trpc.admin.listPricingTiers.useQuery({
    scope,
    scopeId,
  });

  const replaceMutation = trpc.admin.replacePricingTiers.useMutation({
    onSuccess: invalidate,
  });
  const deleteMutation = trpc.admin.deletePricingTiers.useMutation({
    onSuccess: invalidate,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(pricingTierReplaceInputSchema),
    defaultValues: {
      scope,
      scopeId,
      tiers: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "tiers",
  });

  // Re-seed the form when the scope target changes or the server returns fresh data.
  useEffect(() => {
    form.reset({
      scope,
      scopeId,
      tiers:
        existingTiers?.map((t) => ({
          minDays: t.minDays,
          maxDays: t.maxDays,
          tierMode: t.tierMode,
          tierTotal: Number(t.tierTotal),
          pricePerWeek: t.pricePerWeek != null ? Number(t.pricePerWeek) : null,
          isActive: t.isActive,
        })) ?? [],
    });
  }, [scope, scopeId, existingTiers, form]);

  // Live per-day effective rate for each tier, so operators can sanity-check
  // the shape of the ladder as they type. PROGRESSIVE rows show
  // tierTotal/length; PER_WEEK rows show pricePerWeek/7.
  const watchedRaw = useWatch({ control: form.control, name: "tiers" });
  const watchedTiers = useMemo(() => watchedRaw ?? [], [watchedRaw]);
  const effectiveRates = useMemo(
    () =>
      watchedTiers.map((t) => {
        if (t.tierMode === "PER_WEEK") {
          if (!t.pricePerWeek || t.pricePerWeek <= 0) return null;
          return t.pricePerWeek / 7;
        }
        const len = t.maxDays - t.minDays + 1;
        if (len <= 0 || !t.tierTotal) return null;
        return t.tierTotal / len;
      }),
    [watchedTiers],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    await replaceMutation.mutateAsync(values);
  });

  const addTier = () => {
    const last = watchedTiers[watchedTiers.length - 1];
    const nextMin = last ? last.maxDays + 1 : 1;
    const nextMax = nextMin + 6; // sensible 7-day default span
    append({
      minDays: nextMin,
      maxDays: nextMax,
      tierMode: "PROGRESSIVE",
      tierTotal: 0,
      pricePerWeek: null,
      isActive: true,
    });
  };

  const clearAll = async () => {
    await deleteMutation.mutateAsync({ scope, scopeId });
    form.reset({ scope, scopeId, tiers: [] });
  };

  const hasServerTiers = (existingTiers?.length ?? 0) > 0;
  const rootError = form.formState.errors.tiers?.message;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">
              {scopeNoun(scope)[0]!.toUpperCase() + scopeNoun(scope).slice(1)} ladder
            </div>
            <div className="text-base font-medium">{scopeLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={addTier}>
              + Add tier
            </Button>
            {hasServerTiers && (
              <Button
                type="button"
                variant="destructive"
                onClick={clearAll}
                disabled={deleteMutation.isPending}
              >
                Clear all tiers
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading tiers…</p>
        ) : fields.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/40 p-6 text-center">
            <p className="text-sm text-foreground">
              No tiers configured. This {scopeNoun(scope)} inherits the next
              layer (vehicle → model → category → flat daily/weekly/monthly).
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add tiers to switch to progressive pricing — the booking total
              accumulates tier by tier as the rental gets longer.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, i) => {
              const mode = watchedTiers[i]?.tierMode ?? "PROGRESSIVE";
              return (
                <div
                  key={field.id}
                  className="grid items-end gap-3 rounded-md border border-border bg-card p-3 md:grid-cols-[6rem_1rem_6rem_8rem_10rem_1fr_auto]"
                >
                  <FormField
                    control={form.control}
                    name={`tiers.${i}.minDays`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>From (day)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            {...field}
                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div
                    className="hidden self-center pb-2 text-center text-muted-foreground md:block"
                    aria-hidden
                  >
                    →
                  </div>
                  <FormField
                    control={form.control}
                    name={`tiers.${i}.maxDays`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>To (day)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            {...field}
                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`tiers.${i}.tierMode`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mode</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={(v) => field.onChange(v)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="PROGRESSIVE">Progressive</SelectItem>
                            <SelectItem value="PER_WEEK">Per-week</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {mode === "PROGRESSIVE" ? (
                    <FormField
                      control={form.control}
                      name={`tiers.${i}.tierTotal`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tier total (AUD)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              {...field}
                              onChange={(e) => field.onChange(e.target.valueAsNumber)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <FormField
                      control={form.control}
                      name={`tiers.${i}.pricePerWeek`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>$/week (AUD)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={field.value ?? ""}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value === "" ? null : Number(e.target.value),
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <div className="self-end pb-2 text-sm text-muted-foreground">
                    {effectiveRates[i] != null ? (
                      <>
                        ≈ <span className="font-medium text-foreground">
                          {formatCurrency(effectiveRates[i]!)}
                        </span>{" "}
                        / day
                      </>
                    ) : null}
                  </div>
                  <div className="flex justify-end pb-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(i)}
                      aria-label={`Remove tier ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rootError && <p className="text-sm text-destructive">{rootError}</p>}
        {replaceMutation.error && (
          <p className="text-sm text-destructive">
            {replaceMutation.error.message}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <p className="mr-auto text-xs text-muted-foreground">
            Tiers must start at day 1 and be contiguous (e.g. 1–2, 3–7, 8–14).
            Per-week tiers price the whole booking at <code>$/wk × ⌈days/7⌉</code> within the tier.
          </p>
          <Button
            type="submit"
            disabled={replaceMutation.isPending || !form.formState.isDirty}
          >
            {replaceMutation.isPending ? "Saving…" : "Save tiers"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
