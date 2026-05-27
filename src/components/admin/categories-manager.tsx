"use client";

import { useState } from "react";
import { Plus, Pencil, Archive, Undo2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageSection } from "@/components/layout/page-section";
import { CategoryFormSheet } from "@/components/admin/category-form-sheet";
import { CategoryArchiveDialog } from "@/components/admin/category-archive-dialog";
import { formatCurrency } from "@/lib/utils";

type CategoryRow = ReturnType<typeof useCategories>["data"] extends (infer T)[] | undefined ? T : never;

function useCategories() {
  return trpc.admin.listAllCategories.useQuery();
}

/**
 * Vehicle-category management (create / edit / archive / restore). Lives as the
 * "Categories" tab on /admin/pricing — categories define the bookable vehicle
 * classes whose rates are edited on the sibling Rates tab.
 */
export function CategoriesManager() {
  const util = trpc.useUtils();
  const { data: categories, isLoading } = useCategories();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [archiving, setArchiving] = useState<CategoryRow | null>(null);

  const restore = trpc.admin.restoreCategory.useMutation({
    onSuccess: () => util.admin.listAllCategories.invalidate(),
  });

  const columns: DataTableColumn<NonNullable<typeof categories>[number]>[] = [
    {
      id: "name",
      header: "Name",
      accessor: (r) => r.name,
      sortable: true,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">{r.slug}</div>
        </div>
      ),
    },
    {
      id: "engine",
      header: "Engine",
      accessor: (r) => r.engineCapacity,
      sortable: true,
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.engineCapacity}cc</span>,
    },
    {
      id: "licence",
      header: "Licence",
      cell: (r) => <StatusBadge status="STANDARD" label={r.licenceRequired} />,
    },
    {
      id: "minAge",
      header: "Min age",
      accessor: (r) => r.minAge,
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.minAge}</span>,
    },
    {
      id: "rates",
      header: "Rates (daily / weekly / monthly)",
      cell: (r) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatCurrency(Number(r.baseDailyRate))} / {formatCurrency(Number(r.baseWeeklyRate))} /{" "}
          {formatCurrency(Number(r.baseMonthlyRate))}
        </span>
      ),
    },
    {
      id: "bond",
      header: "Bond",
      accessor: (r) => Number(r.bondAmount),
      align: "right",
      cell: (r) => <span className="tabular-nums">{formatCurrency(Number(r.bondAmount))}</span>,
    },
    {
      id: "vehicles",
      header: "Vehicles",
      accessor: (r) => r.activeVehicleCount,
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.activeVehicleCount}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => (r.isActive ? <StatusBadge status="ACTIVE" label="Active" /> : <StatusBadge status="CANCELLED" label="Archived" />),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(r);
            }}
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {r.isActive ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setArchiving(r);
              }}
            >
              <Archive className="h-4 w-4" />
              Archive
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={restore.isPending}
              onClick={(e) => {
                e.stopPropagation();
                restore.mutate({ id: r.id });
              }}
            >
              <Undo2 className="h-4 w-4" />
              Restore
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageSection
        title="All categories"
        description="Active categories show on /fleet. Archived ones are hidden but their booking history is preserved. Rates live on the Rates tab."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New category
          </Button>
        }
      >
        <DataTable
          columns={columns}
          data={categories}
          getRowId={(r) => r.id}
          isLoading={isLoading}
          empty={<p className="text-sm text-muted-foreground">No categories yet. Create your first one.</p>}
        />
      </PageSection>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[540px]">
          <CategoryFormSheet mode="create" onClose={() => setCreateOpen(false)} />
        </SheetContent>
      </Sheet>

      <Sheet open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[540px]">
          {editing && (
            <CategoryFormSheet
              mode="edit"
              initial={{
                id: editing.id,
                name: editing.name,
                slug: editing.slug,
                description: editing.description ?? "",
                engineCapacity: editing.engineCapacity,
                licenceRequired: editing.licenceRequired as "CAR" | "RE" | "R",
                minAge: editing.minAge,
                displayOrder: editing.displayOrder,
                baseDailyRate: Number(editing.baseDailyRate),
                baseWeeklyRate: Number(editing.baseWeeklyRate),
                baseMonthlyRate: Number(editing.baseMonthlyRate),
                bondAmount: Number(editing.bondAmount),
                images: editing.images,
                onlinePaymentStrategy: editing.onlinePaymentStrategy,
                bookingFeeFlat:
                  editing.bookingFeeFlat == null ? null : Number(editing.bookingFeeFlat),
                bookingFeePercent:
                  editing.bookingFeePercent == null ? null : Number(editing.bookingFeePercent),
                longTermMinDays: editing.longTermMinDays ?? null,
                longTermDefaultFrequency: editing.longTermDefaultFrequency,
              }}
              onClose={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {archiving && (
        <CategoryArchiveDialogLoader
          categoryId={archiving.id}
          categoryName={archiving.name}
          onClose={() => setArchiving(null)}
          otherCategories={(categories ?? [])
            .filter((c) => c.id !== archiving.id && c.isActive)
            .map((c) => ({ id: c.id, name: c.name }))}
        />
      )}
    </>
  );
}

function CategoryArchiveDialogLoader({
  categoryId,
  categoryName,
  onClose,
  otherCategories,
}: {
  categoryId: string;
  categoryName: string;
  onClose: () => void;
  otherCategories: Array<{ id: string; name: string }>;
}) {
  const { data } = trpc.admin.categoryActiveVehicles.useQuery({ id: categoryId });
  if (!data) return null;
  return (
    <CategoryArchiveDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      category={{ id: categoryId, name: categoryName }}
      vehicles={data}
      otherCategories={otherCategories}
    />
  );
}
