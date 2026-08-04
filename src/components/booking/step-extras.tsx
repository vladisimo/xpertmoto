"use client";
import * as React from "react";
import { Check, CheckCircle2, Circle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useBookingWizard } from "@/stores/booking-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { AddonIcon } from "./addon-icon";
import { useStepContinueAction } from "@/hooks/use-step-continue-action";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";

export function StepExtras() {
  const w = useBookingWizard();
  const layout = useWizardShellLayout();
  const { data: addons } = trpc.catalog.addons.useQuery();
  const { data: insurance } = trpc.catalog.insurance.useQuery();

  useStepContinueAction({
    label: "Continue",
    disabled: false,
    onClick: () => w.next(),
  });

  // Auto-include required add-ons that haven't been explicitly waived.
  React.useEffect(() => {
    if (!addons) return;
    const required = addons.filter((a) => a.isRequired);
    const selected = new Set(w.addons.map((x) => x.addonId));
    const waived = new Set(w.waivedAddonIds);
    const toAdd = required
      .filter((a) => !selected.has(a.id) && !waived.has(a.id))
      .map((a) => ({ addonId: a.id, quantity: 1 }));
    if (toAdd.length) {
      w.set("addons", [...w.addons, ...toAdd]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons]);

  // M-7: default to the free Basic tier (dailyRate 0) when the user arrives
  // without a prior selection — never auto-opt them into paid cover. The
  // catalogue is ordered by dailyRate ascending so the $0 tier is insurance[0].
  React.useEffect(() => {
    if (!insurance || insurance.length === 0) return;
    if (w.insuranceOptionId) return;
    const freeTier =
      insurance.find((i) => Number(i.dailyRate) === 0) ?? insurance[0];
    if (freeTier) w.set("insuranceOptionId", freeTier.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insurance]);

  // When the customer upgrades from the free tier to a paid one, reassure them
  // that the included $0 cover is still one tap away (avoids accidental spend).
  const selectedInsurance = insurance?.find((i) => i.id === w.insuranceOptionId) ?? null;
  const freeInsurance = insurance?.find((i) => Number(i.dailyRate) === 0) ?? null;
  const paidTierSelected =
    !!selectedInsurance && Number(selectedInsurance.dailyRate) > 0 && !!freeInsurance;

  return (
    <div>
      <h2 className="h2 mb-6 hidden md:block">Extras & insurance</h2>

      <section>
        <h3 className="font-semibold mb-3">Add-ons</h3>

        {/* Mobile: 2-column condensed single-line cards */}
        <div className="grid grid-cols-2 gap-2 md:hidden">
          {addons?.map((a) => {
            const selected = w.addons.some((x) => x.addonId === a.id);
            const price = a.isPerDay
              ? `${formatCurrency(Number(a.dailyRate ?? 0))}/day`
              : formatCurrency(Number(a.flatRate ?? 0));
            const onTap = () => {
              if (a.isRequired && selected) {
                w.waiveAddon(a.id);
              } else {
                w.toggleAddon(a.id);
              }
            };
            return (
              <button
                key={a.id}
                type="button"
                onClick={onTap}
                aria-pressed={selected}
                aria-label={`${a.name}${a.isRequired ? " (required)" : ""} — ${price}`}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-card",
                )}
              >
                <AddonIcon
                  type={a.type}
                  className={cn(
                    "h-4 w-4 shrink-0",
                    selected ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="truncate text-sm font-medium">
                  {a.name}
                  {a.isRequired && (
                    <span
                      className={cn(
                        "ml-0.5",
                        selected ? "text-primary/70" : "text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      *
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "ml-auto whitespace-nowrap text-xs",
                    selected ? "text-primary/80" : "text-muted-foreground",
                  )}
                >
                  {price}
                </span>
              </button>
            );
          })}
        </div>

        {/* Desktop: card grid */}
        <div className="hidden md:grid md:grid-cols-2 gap-3">
          {addons?.map((a) => {
            const selected = w.addons.some((x) => x.addonId === a.id);
            const waived = w.waivedAddonIds.includes(a.id);
            const price = a.isPerDay
              ? `${formatCurrency(Number(a.dailyRate ?? 0))}/day`
              : formatCurrency(Number(a.flatRate ?? 0));

            if (a.isRequired) {
              return (
                <div
                  key={a.id}
                  className={`p-4 border rounded-lg transition ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <AddonIcon
                      type={a.type}
                      className="h-5 w-5 mt-0.5 text-primary shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <div className="font-medium">{a.name}</div>
                        <div className="text-sm whitespace-nowrap">{price}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Required for this rental
                      </div>
                      <div className="mt-3">
                        {selected ? (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="inline-flex items-center gap-1 text-primary font-medium">
                              <Check className="h-3.5 w-3.5" />
                              Included
                            </span>
                            <button
                              type="button"
                              onClick={() => w.waiveAddon(a.id)}
                              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            >
                              I&rsquo;ll bring my own
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">
                              {waived
                                ? "Using your own — please bring it to pickup"
                                : "Not included"}
                            </span>
                            <button
                              type="button"
                              onClick={() => w.toggleAddon(a.id)}
                              className="text-primary underline underline-offset-2 hover:text-primary/80 font-medium"
                            >
                              Include one
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={a.id}
                type="button"
                onClick={() => w.toggleAddon(a.id)}
                className={`p-4 border rounded-lg text-left transition ${
                  selected ? "border-primary bg-primary/5" : "hover:border-primary/50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <AddonIcon
                    type={a.type}
                    className={`h-5 w-5 mt-0.5 shrink-0 ${
                      selected ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  <div className="flex-1 min-w-0 flex justify-between gap-2">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-sm whitespace-nowrap">{price}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="font-semibold mb-1">Insurance</h3>
        {paidTierSelected && (
          <p className="mb-3 text-xs text-muted-foreground">
            You&apos;ve selected{" "}
            <span className="font-medium text-foreground">{selectedInsurance!.name}</span>{" "}
            cover ({formatCurrency(Number(selectedInsurance!.dailyRate))}/day).
            The <span className="font-medium text-foreground">{freeInsurance!.name}</span>{" "}
            tier is included at no extra cost — select it below to switch back.
          </p>
        )}

        {/* Mobile: compact radio-list */}
        <ul className="md:hidden divide-y divide-border overflow-hidden rounded-md border border-border">
          {insurance?.map((i) => {
            const selected = w.insuranceOptionId === i.id;
            const priceLabel =
              Number(i.dailyRate) === 0
                ? "Included"
                : `${formatCurrency(Number(i.dailyRate))}/day`;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => w.set("insuranceOptionId", i.id)}
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                    selected ? "bg-primary/5" : ""
                  }`}
                >
                  {selected ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  ) : (
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{i.name}</span>
                        {Number(i.dailyRate) === 0 && (
                          <Badge variant="secondary" className="shrink-0 px-1.5 py-0.5 text-[0.6rem]">
                            Free
                          </Badge>
                        )}
                      </div>
                      <div className="whitespace-nowrap text-sm font-semibold text-primary">
                        {priceLabel}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[0.7rem] text-muted-foreground">
                      <span>Excess {formatCurrency(Number(i.excessAmount))}</span>
                      {selected && (
                        <span className="font-medium text-primary">Selected</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Desktop: card grid */}
        <div className="hidden md:grid md:grid-cols-3 gap-3">
          {insurance?.map((i) => {
            const selected = w.insuranceOptionId === i.id;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => w.set("insuranceOptionId", i.id)}
                aria-pressed={selected}
                className={`relative p-4 border rounded-lg text-left transition ${
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{i.name}</span>
                  {Number(i.dailyRate) === 0 && (
                    <Badge variant="secondary" className="px-1.5 py-0.5 text-[0.65rem]">
                      Free
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{i.description}</div>
                <div className="mt-3 text-lg font-bold text-primary">
                  {Number(i.dailyRate) === 0 ? "Included" : `${formatCurrency(Number(i.dailyRate))}/day`}
                </div>
                <div className="text-xs text-muted-foreground">
                  Excess {formatCurrency(Number(i.excessAmount))}
                </div>
                {selected && (
                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-medium text-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden />
                    Selected
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {layout === "desktop" && (
        <div className="mt-6 flex justify-between">
          <Button variant="outline" onClick={() => w.back()}>Back</Button>
          <Button variant="cta" onClick={() => w.next()}>Continue</Button>
        </div>
      )}
    </div>
  );
}
