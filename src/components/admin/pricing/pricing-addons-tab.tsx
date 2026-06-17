"use client";

import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { NumberCell, ActiveBadge, type AddonRow } from "@/components/admin/pricing/pricing-shared";

export function PricingAddonsTab() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const upsertAddon = trpc.admin.upsertAddon.useMutation({
    onSuccess: () => util.admin.pricingSummary.invalidate(),
  });

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
      cell: (a) => <span className="text-muted-foreground">{a.isPerDay ? "Per day" : "Flat"}</span>,
    },
    {
      id: "required",
      header: "Required",
      cell: (a) => <span className="text-muted-foreground">{a.isRequired ? "Yes" : "No"}</span>,
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

  return (
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
  );
}
