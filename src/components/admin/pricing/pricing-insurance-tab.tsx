"use client";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { NumberCell, ActiveBadge, type InsuranceRow } from "@/components/admin/pricing/pricing-shared";

export function PricingInsuranceTab() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const upsertInsurance = trpc.admin.upsertInsurance.useMutation({
    onSuccess: () => util.admin.pricingSummary.invalidate(),
  });

  const insuranceColumns: DataTableColumn<InsuranceRow>[] = [
    {
      id: "name",
      header: "Tier",
      primary: true,
      cell: (i) => (
        <div className="min-w-0">
          <div className="font-medium">{i.name}</div>
          {i.description && <div className="truncate text-xs text-muted-foreground">{i.description}</div>}
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

  return (
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
  );
}
