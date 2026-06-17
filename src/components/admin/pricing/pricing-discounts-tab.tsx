"use client";

import { useState } from "react";
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
import { PageSection } from "@/components/layout/page-section";
import { ActiveBadge, type DiscountRow } from "@/components/admin/pricing/pricing-shared";

export function PricingDiscountsTab() {
  const util = trpc.useUtils();
  const { data } = trpc.admin.pricingSummary.useQuery();
  const upsertDiscount = trpc.admin.upsertDiscount.useMutation({
    onSuccess: () => util.admin.pricingSummary.invalidate(),
  });
  const [newDiscount, setNewDiscount] = useState({
    code: "",
    type: "PERCENTAGE" as "PERCENTAGE" | "FIXED",
    value: 10,
    isActive: true,
  });

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
        <span className="text-muted-foreground">{d.type.charAt(0) + d.type.slice(1).toLowerCase()}</span>
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

  return (
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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
          <Button disabled={!newDiscount.code || upsertDiscount.isPending} onClick={() => upsertDiscount.mutate(newDiscount)}>
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
  );
}
