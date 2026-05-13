"use client";
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { FinanceTabsBar } from "@/components/admin/finance-tabs-bar";
import { TieredPricingPanel } from "@/components/admin/pricing/tiered-pricing-panel";

type Tab = "rates" | "addons" | "insurance" | "discounts" | "seasons";
type RatesView = "base" | "tiered";

type PricingSummary = inferRouterOutputs<AppRouter>["admin"]["pricingSummary"];
type CategoryRow = PricingSummary["categories"][number];
type AddonRow = PricingSummary["addons"][number];
type InsuranceRow = PricingSummary["insurance"][number];
type DiscountRow = PricingSummary["discounts"][number];
type SeasonRow = PricingSummary["seasons"][number];

export default function PricingPage() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const invalidate = () => util.admin.pricingSummary.invalidate();
  const updateRates = trpc.admin.updateCategoryRates.useMutation({ onSuccess: invalidate });
  const upsertAddon = trpc.admin.upsertAddon.useMutation({ onSuccess: invalidate });
  const upsertInsurance = trpc.admin.upsertInsurance.useMutation({ onSuccess: invalidate });
  const upsertDiscount = trpc.admin.upsertDiscount.useMutation({ onSuccess: invalidate });
  const upsertSeason = trpc.admin.upsertSeason.useMutation({ onSuccess: invalidate });

  const [tab, setTab] = useState<Tab>("rates");
  const [ratesView, setRatesView] = useState<RatesView>("base");
  const [newDiscount, setNewDiscount] = useState({ code: "", type: "PERCENTAGE" as "PERCENTAGE" | "FIXED", value: 10, isActive: true });
  const [newSeason, setNewSeason] = useState({ name: "", startDate: "", endDate: "", multiplier: 1.2, isActive: true });

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
        <NumberCell
          value={Number(c.baseDailyRate)}
          onSave={(v) => updateRates.mutate({ id: c.id, baseDailyRate: v })}
        />
      ),
    },
    {
      id: "weekly",
      header: "Weekly",
      align: "right",
      width: "10rem",
      cell: (c) => (
        <NumberCell
          value={Number(c.baseWeeklyRate)}
          onSave={(v) => updateRates.mutate({ id: c.id, baseWeeklyRate: v })}
        />
      ),
    },
    {
      id: "monthly",
      header: "Monthly",
      align: "right",
      width: "10rem",
      cell: (c) => (
        <NumberCell
          value={Number(c.baseMonthlyRate)}
          onSave={(v) => updateRates.mutate({ id: c.id, baseMonthlyRate: v })}
        />
      ),
    },
    {
      id: "bond",
      header: "Bond",
      align: "right",
      width: "10rem",
      cell: (c) => (
        <NumberCell
          value={Number(c.bondAmount)}
          onSave={(v) => updateRates.mutate({ id: c.id, bondAmount: v })}
        />
      ),
    },
  ];

  const addonColumns: DataTableColumn<AddonRow>[] = [
    {
      id: "name",
      header: "Name",
      primary: true,
      cell: (a) => (
        <div className="min-w-0">
          <div className="font-medium">{a.name}</div>
          <div className="text-xs text-muted-foreground">{a.type.replace(/_/g, " ").toLowerCase()}</div>
        </div>
      ),
    },
    {
      id: "billing",
      header: "Billing",
      cell: (a) => (
        <span className="text-muted-foreground">{a.isPerDay ? "Per day" : "Flat"}</span>
      ),
    },
    {
      id: "required",
      header: "Required",
      cell: (a) => (
        <span className="text-muted-foreground">{a.isRequired ? "Yes" : "No"}</span>
      ),
    },
    {
      id: "rate",
      header: "Rate",
      align: "right",
      width: "10rem",
      cell: (a) => (
        <NumberCell
          value={Number(a.dailyRate ?? a.flatRate ?? 0)}
          onSave={(v) =>
            upsertAddon.mutate({
              id: a.id,
              name: a.name,
              type: a.type,
              isPerDay: a.isPerDay,
              isRequired: a.isRequired,
              isActive: a.isActive,
              ...(a.isPerDay ? { dailyRate: v } : { flatRate: v }),
            })
          }
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "7rem",
      cell: (a) => <ActiveBadge active={a.isActive} />,
    },
  ];

  const insuranceColumns: DataTableColumn<InsuranceRow>[] = [
    {
      id: "name",
      header: "Tier",
      primary: true,
      cell: (i) => (
        <div className="min-w-0">
          <div className="font-medium">{i.name}</div>
          {i.description && (
            <div className="truncate text-xs text-muted-foreground">{i.description}</div>
          )}
        </div>
      ),
    },
    {
      id: "daily",
      header: "Daily rate",
      align: "right",
      width: "10rem",
      cell: (i) => (
        <NumberCell
          value={Number(i.dailyRate)}
          onSave={(v) =>
            upsertInsurance.mutate({
              id: i.id,
              name: i.name,
              description: i.description ?? undefined,
              dailyRate: v,
              excessAmount: Number(i.excessAmount),
              isActive: i.isActive,
            })
          }
        />
      ),
    },
    {
      id: "excess",
      header: "Excess",
      align: "right",
      width: "10rem",
      cell: (i) => (
        <NumberCell
          value={Number(i.excessAmount)}
          onSave={(v) =>
            upsertInsurance.mutate({
              id: i.id,
              name: i.name,
              description: i.description ?? undefined,
              dailyRate: Number(i.dailyRate),
              excessAmount: v,
              isActive: i.isActive,
            })
          }
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "7rem",
      cell: (i) => <ActiveBadge active={i.isActive} />,
    },
  ];

  const discountColumns: DataTableColumn<DiscountRow>[] = [
    {
      id: "code",
      header: "Code",
      primary: true,
      cell: (d) => <span className="font-mono font-medium">{d.code}</span>,
    },
    {
      id: "type",
      header: "Type",
      secondary: true,
      cell: (d) => (
        <span className="text-muted-foreground">
          {d.type.charAt(0) + d.type.slice(1).toLowerCase()}
        </span>
      ),
    },
    {
      id: "value",
      header: "Value",
      align: "right",
      cell: (d) => (
        <span className="font-medium">
          {Number(d.value)}
          {d.type === "PERCENTAGE" ? "%" : ""}
        </span>
      ),
    },
    {
      id: "usage",
      header: "Usage",
      align: "right",
      cell: (d) => (
        <span className="text-muted-foreground">
          {d.usedCount}
          {d.maxUses ? ` / ${d.maxUses}` : ""}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "7rem",
      cell: (d) => <ActiveBadge active={d.isActive} />,
    },
  ];

  const seasonColumns: DataTableColumn<SeasonRow>[] = [
    {
      id: "name",
      header: "Name",
      primary: true,
      cell: (s) => <span className="font-medium">{s.name}</span>,
    },
    {
      id: "start",
      header: "Start",
      cell: (s) => new Date(s.startDate).toLocaleDateString("en-AU"),
    },
    {
      id: "end",
      header: "End",
      cell: (s) => new Date(s.endDate).toLocaleDateString("en-AU"),
    },
    {
      id: "multiplier",
      header: "Multiplier",
      align: "right",
      cell: (s) => <span className="font-medium">×{Number(s.multiplier)}</span>,
    },
    {
      id: "status",
      header: "Status",
      width: "7rem",
      cell: (s) => <ActiveBadge active={s.isActive} />,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration · Finance"
        title="Pricing"
        description="Base rates, add-ons, insurance tiers, discounts, and seasonal multipliers."
      />

      <FinanceTabsBar />

      <div className="-mx-3 flex gap-2 overflow-x-auto border-b px-3 sm:mx-0 sm:overflow-visible sm:px-0">
        {(["rates", "addons", "insurance", "discounts", "seasons"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "rates" && (
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
      )}

      {tab === "addons" && (
        <DataTable
          columns={addonColumns}
          data={data?.addons}
          getRowId={(a) => a.id}
          rowActions={(a) => (
            <Button
              size="sm"
              variant={a.isActive ? "secondary" : "default"}
              onClick={() =>
                upsertAddon.mutate({
                  id: a.id,
                  name: a.name,
                  type: a.type,
                  isPerDay: a.isPerDay,
                  isRequired: a.isRequired,
                  isActive: !a.isActive,
                  dailyRate: a.dailyRate ? Number(a.dailyRate) : undefined,
                  flatRate: a.flatRate ? Number(a.flatRate) : undefined,
                })
              }
            >
              {a.isActive ? "Disable" : "Enable"}
            </Button>
          )}
          empty="No add-ons configured."
          mobileMode="cards"
        />
      )}

      {tab === "insurance" && (
        <DataTable
          columns={insuranceColumns}
          data={data?.insurance}
          getRowId={(i) => i.id}
          rowActions={(i) => (
            <Button
              size="sm"
              variant={i.isActive ? "secondary" : "default"}
              onClick={() =>
                upsertInsurance.mutate({
                  id: i.id,
                  name: i.name,
                  description: i.description ?? undefined,
                  dailyRate: Number(i.dailyRate),
                  excessAmount: Number(i.excessAmount),
                  isActive: !i.isActive,
                })
              }
            >
              {i.isActive ? "Disable" : "Enable"}
            </Button>
          )}
          empty="No insurance tiers configured."
          mobileMode="cards"
        />
      )}

      {tab === "discounts" && (
        <>
          <PageSection title="New discount">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <Input
                placeholder="CODE"
                value={newDiscount.code}
                onChange={(e) => setNewDiscount({ ...newDiscount, code: e.target.value.toUpperCase() })}
              />
              <Select
                value={newDiscount.type}
                onValueChange={(v) => setNewDiscount({ ...newDiscount, type: v as "PERCENTAGE" | "FIXED" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                  <SelectItem value="FIXED">Fixed</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Value"
                value={newDiscount.value}
                onChange={(e) => setNewDiscount({ ...newDiscount, value: Number(e.target.value) })}
              />
              <Button
                disabled={!newDiscount.code || upsertDiscount.isPending}
                onClick={() => upsertDiscount.mutate(newDiscount)}
              >
                Create
              </Button>
            </div>
          </PageSection>

          <DataTable
            columns={discountColumns}
            data={data?.discounts}
            getRowId={(d) => d.id}
            rowActions={(d) => (
              <Button
                size="sm"
                variant={d.isActive ? "secondary" : "default"}
                onClick={() =>
                  upsertDiscount.mutate({
                    id: d.id,
                    code: d.code,
                    type: d.type,
                    value: Number(d.value),
                    isActive: !d.isActive,
                  })
                }
              >
                {d.isActive ? "Disable" : "Enable"}
              </Button>
            )}
            empty="No discount codes yet."
            mobileMode="cards"
          />
        </>
      )}

      {tab === "seasons" && (
        <>
          <PageSection title="New season">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
              <Input
                placeholder="Name"
                value={newSeason.name}
                onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })}
              />
              <Input
                type="date"
                value={newSeason.startDate}
                onChange={(e) => setNewSeason({ ...newSeason, startDate: e.target.value })}
              />
              <Input
                type="date"
                value={newSeason.endDate}
                onChange={(e) => setNewSeason({ ...newSeason, endDate: e.target.value })}
              />
              <Input
                type="number"
                step="0.05"
                value={newSeason.multiplier}
                onChange={(e) => setNewSeason({ ...newSeason, multiplier: Number(e.target.value) })}
              />
              <Button
                disabled={!newSeason.name || !newSeason.startDate || upsertSeason.isPending}
                onClick={() =>
                  upsertSeason.mutate({
                    name: newSeason.name,
                    startDate: new Date(newSeason.startDate),
                    endDate: new Date(newSeason.endDate),
                    multiplier: newSeason.multiplier,
                    isActive: true,
                  })
                }
              >
                Create
              </Button>
            </div>
          </PageSection>

          <DataTable
            columns={seasonColumns}
            data={data?.seasons}
            getRowId={(s) => s.id}
            rowActions={(s) => (
              <Button
                size="sm"
                variant={s.isActive ? "secondary" : "default"}
                onClick={() =>
                  upsertSeason.mutate({
                    id: s.id,
                    name: s.name,
                    startDate: s.startDate,
                    endDate: s.endDate,
                    multiplier: Number(s.multiplier),
                    isActive: !s.isActive,
                  })
                }
              >
                {s.isActive ? "Disable" : "Enable"}
              </Button>
            )}
            empty="No seasons configured."
            mobileMode="cards"
          />
        </>
      )}

    </PageShell>
  );
}

function NumberCell({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(value);
  return (
    <Input
      type="number"
      value={v}
      onChange={(e) => setV(Number(e.target.value))}
      onBlur={() => v !== value && onSave(v)}
      className="h-9 text-right"
    />
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <StatusBadge status="AVAILABLE" />
  ) : (
    <StatusBadge status="CANCELLED" label="Inactive" />
  );
}
