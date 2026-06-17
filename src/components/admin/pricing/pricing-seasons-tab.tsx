"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageSection } from "@/components/layout/page-section";
import { ActiveBadge, type SeasonRow } from "@/components/admin/pricing/pricing-shared";

export function PricingSeasonsTab() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const upsertSeason = trpc.admin.upsertSeason.useMutation({
    onSuccess: () => util.admin.pricingSummary.invalidate(),
  });
  const [newSeason, setNewSeason] = useState({
    name: "",
    startDate: "",
    endDate: "",
    multiplier: 1.2,
    isActive: true,
  });

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
  );
}
