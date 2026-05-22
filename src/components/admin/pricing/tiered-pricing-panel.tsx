"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection } from "@/components/layout/page-section";
import { TierEditor } from "./tier-editor";
import type { PricingTierScope } from "@/lib/validators/pricing-tier";

export function TieredPricingPanel() {
  const [scope, setScope] = useState<PricingTierScope>("CATEGORY");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const categoriesQuery = trpc.admin.pricingSummary.useQuery();
  const modelsQuery = trpc.admin.modelRates.useQuery(undefined, {
    enabled: scope === "MODEL",
  });
  const vehiclesQuery = trpc.fleet.listVehicles.useQuery(undefined, {
    enabled: scope === "VEHICLE",
  });

  const categories = categoriesQuery.data?.categories ?? [];
  const models = modelsQuery.data?.models ?? [];
  const vehicles = vehiclesQuery.data ?? [];

  const scopeOptions =
    scope === "CATEGORY"
      ? categories.map((c) => ({ id: c.id, label: `${c.name} (${c.engineCapacity}cc)` }))
      : scope === "MODEL"
        ? models.map((m) => ({
            id: m.id,
            label: `${m.make} ${m.model}${m.year ? ` ${m.year}` : ""}`,
          }))
        : vehicles.map((v) => ({
            id: v.id,
            label: `${v.internalCode} · ${v.make} ${v.model} (${v.rego})`,
          }));

  const selectedLabel =
    scopeOptions.find((o) => o.id === selectedId)?.label ?? "";

  const onScopeChange = (next: PricingTierScope) => {
    setScope(next);
    setSelectedId(null);
  };

  const scopeNoun =
    scope === "CATEGORY" ? "category" : scope === "MODEL" ? "model" : "vehicle";

  return (
    <PageSection
      title="Tiered pricing"
      description="Progressive (tax-bracket) or per-week ladder. Vehicle ladders override model ladders, which override category ladders."
    >
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-muted-foreground">Apply to</span>
            <Select value={scope} onValueChange={(v) => onScopeChange(v as PricingTierScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CATEGORY">Vehicle category</SelectItem>
                <SelectItem value="MODEL">Vehicle model (default per make/model)</SelectItem>
                <SelectItem value="VEHICLE">Specific vehicle (override)</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-muted-foreground">
              {scopeNoun[0]!.toUpperCase() + scopeNoun.slice(1)}
            </span>
            <Select
              value={selectedId ?? ""}
              onValueChange={(v) => setSelectedId(v)}
              disabled={
                (scope === "VEHICLE" && vehiclesQuery.isLoading) ||
                (scope === "MODEL" && modelsQuery.isLoading)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={`Pick a ${scopeNoun}`} />
              </SelectTrigger>
              <SelectContent>
                {scopeOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
                {scopeOptions.length === 0 && (
                  <SelectItem value="__none" disabled>
                    None available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </label>
        </div>

        {selectedId ? (
          <TierEditor
            key={`${scope}:${selectedId}`}
            scope={scope}
            scopeId={selectedId}
            scopeLabel={selectedLabel}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick a {scopeNoun} to view or edit its tier ladder.
          </p>
        )}
      </div>
    </PageSection>
  );
}
