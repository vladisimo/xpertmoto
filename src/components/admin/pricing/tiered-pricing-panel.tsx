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
  const vehiclesQuery = trpc.fleet.listVehicles.useQuery(undefined, {
    enabled: scope === "VEHICLE",
  });

  const categories = categoriesQuery.data?.categories ?? [];
  const vehicles = vehiclesQuery.data ?? [];

  const scopeOptions =
    scope === "CATEGORY"
      ? categories.map((c) => ({ id: c.id, label: `${c.name} (${c.engineCapacity}cc)` }))
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

  return (
    <PageSection
      title="Tiered pricing"
      description="Progressive, tax-bracket-style rate ladder. Fills cheaper tiers the longer a rental runs. When set, this replaces the flat duration discount."
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
                <SelectItem value="VEHICLE">Specific vehicle (override)</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-muted-foreground">
              {scope === "CATEGORY" ? "Category" : "Vehicle"}
            </span>
            <Select
              value={selectedId ?? ""}
              onValueChange={(v) => setSelectedId(v)}
              disabled={scope === "VEHICLE" && vehiclesQuery.isLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    scope === "CATEGORY" ? "Pick a category" : "Pick a vehicle"
                  }
                />
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
            Pick a {scope === "CATEGORY" ? "category" : "vehicle"} to view or
            edit its tier ladder.
          </p>
        )}
      </div>
    </PageSection>
  );
}
