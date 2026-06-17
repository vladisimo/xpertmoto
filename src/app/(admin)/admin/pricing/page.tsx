"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { TieredPricingPanel } from "@/components/admin/pricing/tiered-pricing-panel";
import { TierEditor } from "@/components/admin/pricing/tier-editor";
import { CategoriesManager } from "@/components/admin/categories-manager";
import {
  Bike,
  CalendarRange,
  DollarSign,
  Percent,
  PlusCircle,
  Shapes,
  Umbrella,
  type LucideIcon,
} from "lucide-react";

type Tab = "rates" | "categories" | "models" | "addons" | "insurance" | "discounts" | "seasons";

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: "rates", label: "Rates", icon: DollarSign },
  { value: "categories", label: "Categories", icon: Shapes },
  { value: "models", label: "Models", icon: Bike },
  { value: "addons", label: "Add-ons", icon: PlusCircle },
  { value: "insurance", label: "Insurance", icon: Umbrella },
  { value: "discounts", label: "Discounts", icon: Percent },
  { value: "seasons", label: "Seasons", icon: CalendarRange },
];
type RatesView = "base" | "tiered";

type PricingSummary = inferRouterOutputs<AppRouter>["admin"]["pricingSummary"];
type ModelRatesSummary = inferRouterOutputs<AppRouter>["admin"]["modelRates"];
type CategoryRow = PricingSummary["categories"][number];
type AddonRow = PricingSummary["addons"][number];
type InsuranceRow = PricingSummary["insurance"][number];
type DiscountRow = PricingSummary["discounts"][number];
type SeasonRow = PricingSummary["seasons"][number];
type ModelRow = ModelRatesSummary["models"][number];

export default function PricingPage() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const { data: modelData } = trpc.admin.modelRates.useQuery();
  const invalidate = () => util.admin.pricingSummary.invalidate();
  const invalidateModels = () => util.admin.modelRates.invalidate();
  const updateRates = trpc.admin.updateCategoryRates.useMutation({ onSuccess: invalidate });
  const updateModelRates = trpc.admin.updateModelRates.useMutation({
    onSuccess: invalidateModels,
  });
  const upsertAddon = trpc.admin.upsertAddon.useMutation({ onSuccess: invalidate });
  const upsertInsurance = trpc.admin.upsertInsurance.useMutation({ onSuccess: invalidate });
  const upsertDiscount = trpc.admin.upsertDiscount.useMutation({ onSuccess: invalidate });
  const upsertSeason = trpc.admin.upsertSeason.useMutation({ onSuccess: invalidate });

  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab") as Tab | null;
  // URL-driven so the section rail (and deep links) control the active tab.
  const tab: Tab = urlTab && TABS.some((t) => t.value === urlTab) ? urlTab : "rates";
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "rates") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/admin/pricing?${qs}` : "/admin/pricing", { scroll: false });
  };
  const [ratesView, setRatesView] = useState<RatesView>("base");
  const [newDiscount, setNewDiscount] = useState({ code: "", type: "PERCENTAGE" as "PERCENTAGE" | "FIXED", value: 10, isActive: true });
  const [newSeason, setNewSeason] = useState({ name: "", startDate: "", endDate: "", multiplier: 1.2, isActive: true });

  const tierCountByCategory = data?.tierCountByCategory ?? {};
  const tierCountByModel = modelData?.tierCountByModel ?? {};
  const tiersByModel = modelData?.tiersByModel ?? {};

  // Models tab UX state — filters + which model is being edited.
  const [modelSearch, setModelSearch] = useState("");
  const [modelCategory, setModelCategory] = useState<string>("__all");
  const [modelFleetFilter, setModelFleetFilter] = useState<
    "all" | "with-fleet" | "without-fleet"
  >("all");
  const [editingModel, setEditingModel] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [modelPage, setModelPage] = useState(1);
  const [modelPageSize, setModelPageSize] = useState(25);

  const filteredModels = (modelData?.models ?? []).filter((m) => {
    if (modelCategory !== "__all" && m.category?.id !== modelCategory) return false;
    if (modelFleetFilter === "with-fleet" && m._count.vehicles === 0) return false;
    if (modelFleetFilter === "without-fleet" && m._count.vehicles > 0) return false;
    if (modelSearch.trim().length > 0) {
      const q = modelSearch.trim().toLowerCase();
      if (
        !m.make.toLowerCase().includes(q) &&
        !m.model.toLowerCase().includes(q) &&
        !`${m.make} ${m.model}`.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  // Reset to the first page whenever the filtered set or page size changes,
  // so the visible slice never points past the end of the list.
  useEffect(() => {
    setModelPage(1);
  }, [modelSearch, modelCategory, modelFleetFilter, modelPageSize]);

  const modelPageCount = Math.max(1, Math.ceil(filteredModels.length / modelPageSize));
  const modelSafePage = Math.min(modelPage, modelPageCount);
  const pagedModels = filteredModels.slice(
    (modelSafePage - 1) * modelPageSize,
    modelSafePage * modelPageSize,
  );

  const modelColumns: DataTableColumn<ModelRow>[] = [
    {
      id: "name",
      header: "Make · Model",
      primary: true,
      cell: (m) => {
        const tiers = tiersByModel[m.id] ?? [];
        const tierCount = tierCountByModel[m.id] ?? 0;
        return (
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {m.make} {m.model}
              </span>
              {m.year ? (
                <span className="text-xs text-muted-foreground">{m.year}</span>
              ) : null}
              {tierCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {tierCount} tier{tierCount === 1 ? "" : "s"}
                </span>
              )}
              {m._count.vehicles === 0 && (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  No fleet
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {m.category?.name ?? "Uncategorised"}
            </div>
            {tiers.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {renderTierPreview(tiers)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "baseRate",
      header: "Base rate",
      align: "right",
      width: "10rem",
      cell: (m) => (
        <NumberCell
          value={m.baseRate ? Number(m.baseRate) : 0}
          onSave={(v) =>
            updateModelRates.mutate({ id: m.id, baseRate: v > 0 ? v : null })
          }
        />
      ),
    },
    {
      id: "basePeriodHours",
      header: "Period",
      width: "8rem",
      cell: (m) => (
        <Select
          value={m.basePeriodHours ?? "H24"}
          onValueChange={(v) =>
            updateModelRates.mutate({ id: m.id, basePeriodHours: v as "H24" | "H48" })
          }
        >
          <SelectTrigger className="h-9 w-[6.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="H24">24 h</SelectItem>
            <SelectItem value="H48">48 h</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      id: "fleetCount",
      header: "Fleet",
      align: "right",
      cell: (m) => (
        <span className="text-muted-foreground">{m._count.vehicles}</span>
      ),
    },
  ];

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
    <SectionShell section="pricing">
      <PageShell full={tab === "models"}>
      <PageHeader
        eyebrow="Administration"
        title="Pricing"
        description="Base rates, add-ons, insurance tiers, discounts, and seasonal multipliers."
      />

      <div className="-mx-3 flex gap-2 overflow-x-auto border-b px-3 sm:mx-0 sm:overflow-visible sm:px-0 lg:hidden">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
                tab === t.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
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

      {tab === "categories" && <CategoriesManager />}

      {tab === "models" && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <p className="shrink-0 text-sm text-muted-foreground">
            Per-model (make + model) base rate and base period. When set, these
            override the category default for every vehicle of that model. Leave
            base rate empty to fall back to the category daily rate. Set period
            to 48 h for premium bikes that rent in 2-day minimums.
          </p>

          <div className="grid shrink-0 gap-3 md:grid-cols-[1fr_12rem_12rem]">
            <Input
              placeholder="Search make or model…"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              aria-label="Search models"
            />
            <Select value={modelCategory} onValueChange={setModelCategory}>
              <SelectTrigger>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All categories</SelectItem>
                {(data?.categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={modelFleetFilter}
              onValueChange={(v) =>
                setModelFleetFilter(v as typeof modelFleetFilter)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                <SelectItem value="with-fleet">With fleet</SelectItem>
                <SelectItem value="without-fleet">Without fleet</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="shrink-0 text-xs text-muted-foreground">
            Showing {filteredModels.length} of {modelData?.models.length ?? 0} models
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex-1 overflow-auto">
              <DataTable
                columns={modelColumns}
                data={pagedModels}
                getRowId={(m) => m.id}
                rowActions={(m) => (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setEditingModel({
                        id: m.id,
                        label: `${m.make} ${m.model}${m.year ? ` ${m.year}` : ""}`,
                      })
                    }
                  >
                    {(tierCountByModel[m.id] ?? 0) > 0 ? "Edit tiers" : "Add tiers"}
                  </Button>
                )}
                empty="No models match the current filters."
                className="rounded-none border-0 shadow-none"
                stickyHeader
                mobileMode="cards"
              />
            </div>
            <div className="shrink-0 border-t bg-muted/30 px-4 py-2">
              <DataTablePagination
                page={modelSafePage}
                pageSize={modelPageSize}
                totalCount={filteredModels.length}
                pageCount={modelPageCount}
                onPageChange={setModelPage}
                onPageSizeChange={setModelPageSize}
                emptyLabel="No models"
              />
            </div>
          </div>

          <Dialog
            open={editingModel !== null}
            onOpenChange={(open) => {
              if (!open) setEditingModel(null);
            }}
          >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Tier ladder · {editingModel?.label}</DialogTitle>
                <DialogDescription>
                  Edit the per-model PricingTier ladder. Saved changes apply to
                  every vehicle of this model unless that vehicle has its own
                  override ladder.
                </DialogDescription>
              </DialogHeader>
              {editingModel ? (
                <TierEditor
                  key={editingModel.id}
                  scope="MODEL"
                  scopeId={editingModel.id}
                  scopeLabel={editingModel.label}
                />
              ) : null}
            </DialogContent>
          </Dialog>
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
    </SectionShell>
  );
}

type TierRow = NonNullable<
  ModelRatesSummary["tiersByModel"][string]
>[number];

function renderTierPreview(tiers: TierRow[]): string {
  // Compact one-line summary of the ladder so operators can read the rate
  // card without opening the editor. Falls back to a tier-count when the
  // mix is weird (mode-switched mid-ladder, both fields blank).
  const sorted = [...tiers].sort((a, b) => a.minDays - b.minDays);
  if (sorted.every((t) => t.tierMode === "PER_WEEK" && t.pricePerWeek != null)) {
    return sorted
      .map((t) => `$${Number(t.pricePerWeek!).toFixed(0)}/wk`)
      .join(" → ");
  }
  if (sorted.every((t) => t.tierMode === "PROGRESSIVE")) {
    return sorted.map((t) => `$${Number(t.tierTotal).toFixed(0)}`).join(" + ");
  }
  return `${tiers.length} mixed tier(s)`;
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
