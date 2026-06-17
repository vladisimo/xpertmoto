"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { TieredPricingPanel } from "@/components/admin/pricing/tiered-pricing-panel";
import { NumberCell, type CategoryRow } from "@/components/admin/pricing/pricing-shared";

type RatesView = "base" | "tiered";

export function PricingRatesTab() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const updateRates = trpc.admin.updateCategoryRates.useMutation({
    onSuccess: () => util.admin.pricingSummary.invalidate(),
  });
  const [ratesView, setRatesView] = useState<RatesView>("base");
  const tierCountByCategory = data?.tierCountByCategory ?? {};

  const rateColumns: DataTableColumn<CategoryRow>[] = [
    {
      id: "name",
      header: "Category",
      primary: true,
      cell: (c) => {
        const tierCount = tierCountByCategory[c.id] ?? 0;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {tierCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {tierCount} tier{tierCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{c.engineCapacity}cc</div>
          </div>
        );
      },
    },
    {
      id: "daily",
      header: "Daily",
      align: "right",
      width: "10rem",
      cell: (c) => (
        <NumberCell value={Number(c.baseDailyRate)} onSave={(v) => updateRates.mutate({ id: c.id, baseDailyRate: v })} />
      ),
    },
    {
      id: "weekly",
      header: "Weekly",
      align: "right",
      width: "10rem",
      cell: (c) => (
        <NumberCell value={Number(c.baseWeeklyRate)} onSave={(v) => updateRates.mutate({ id: c.id, baseWeeklyRate: v })} />
      ),
    },
    {
      id: "monthly",
      header: "Monthly",
      align: "right",
      width: "10rem",
      cell: (c) => (
        <NumberCell value={Number(c.baseMonthlyRate)} onSave={(v) => updateRates.mutate({ id: c.id, baseMonthlyRate: v })} />
      ),
    },
    {
      id: "bond",
      header: "Bond",
      align: "right",
      width: "10rem",
      cell: (c) => (
        <NumberCell value={Number(c.bondAmount)} onSave={(v) => updateRates.mutate({ id: c.id, bondAmount: v })} />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-md border border-border bg-muted p-1 text-sm">
        <button
          type="button"
          onClick={() => setRatesView("base")}
          className={`rounded px-3 py-1 font-medium transition-colors ${
            ratesView === "base"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Base rates
        </button>
        <button
          type="button"
          onClick={() => setRatesView("tiered")}
          className={`rounded px-3 py-1 font-medium transition-colors ${
            ratesView === "tiered"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Tiered pricing
        </button>
      </div>

      {ratesView === "base" && (
        <DataTable
          columns={rateColumns}
          data={data?.categories}
          getRowId={(c) => c.id}
          empty="No vehicle categories configured."
          mobileMode="cards"
        />
      )}

      {ratesView === "tiered" && <TieredPricingPanel />}
    </div>
  );
}
