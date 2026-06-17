"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TierEditor } from "@/components/admin/pricing/tier-editor";
import {
  NumberCell,
  renderTierPreview,
  type ModelRow,
} from "@/components/admin/pricing/pricing-shared";

export function PricingModelsTab() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const { data: modelData } = trpc.admin.modelRates.useQuery();
  const updateModelRates = trpc.admin.updateModelRates.useMutation({
    onSuccess: () => util.admin.modelRates.invalidate(),
  });

  const tierCountByModel = modelData?.tierCountByModel ?? {};
  const tiersByModel = modelData?.tiersByModel ?? {};

  const [modelSearch, setModelSearch] = useState("");
  const [modelCategory, setModelCategory] = useState<string>("__all");
  const [modelFleetFilter, setModelFleetFilter] = useState<"all" | "with-fleet" | "without-fleet">("all");
  const [editingModel, setEditingModel] = useState<{ id: string; label: string } | null>(null);
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

  // Reset to the first page whenever the filtered set or page size changes.
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
              {m.year ? <span className="text-xs text-muted-foreground">{m.year}</span> : null}
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
            <div className="text-xs text-muted-foreground">{m.category?.name ?? "Uncategorised"}</div>
            {tiers.length > 0 && (
              <div className="text-xs text-muted-foreground">{renderTierPreview(tiers)}</div>
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
          onSave={(v) => updateModelRates.mutate({ id: m.id, baseRate: v > 0 ? v : null })}
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
          onValueChange={(v) => updateModelRates.mutate({ id: m.id, basePeriodHours: v as "H24" | "H48" })}
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
      cell: (m) => <span className="text-muted-foreground">{m._count.vehicles}</span>,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="shrink-0 text-sm text-muted-foreground">
        Per-model (make + model) base rate and base period. When set, these override the category
        default for every vehicle of that model. Leave base rate empty to fall back to the category
        daily rate. Set period to 48 h for premium bikes that rent in 2-day minimums.
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
        <Select value={modelFleetFilter} onValueChange={(v) => setModelFleetFilter(v as typeof modelFleetFilter)}>
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

      <Dialog open={editingModel !== null} onOpenChange={(open) => { if (!open) setEditingModel(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tier ladder · {editingModel?.label}</DialogTitle>
            <DialogDescription>
              Edit the per-model PricingTier ladder. Saved changes apply to every vehicle of this
              model unless that vehicle has its own override ladder.
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
  );
}
