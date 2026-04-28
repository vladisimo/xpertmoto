"use client";

import * as React from "react";
import Image from "next/image";
import { Bike } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";

export type FleetVehicleRow = {
  id: string;
  internalCode: string;
  rego: string;
  regoExpiry: Date | null;
  make: string;
  model: string;
  year: number;
  colour: string | null;
  status: string;
  thumbnailUrl: string | null;
  categoryName: string;
  depotName: string;
};

export function FleetVehiclesTable({ data }: { data: FleetVehicleRow[] }) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);

  const totalCount = data.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const pageSlice = React.useMemo(
    () => data.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
    [data, clampedPage, pageSize],
  );

  const columns: DataTableColumn<FleetVehicleRow>[] = [
    {
      id: "thumb",
      header: <span className="sr-only">Photo</span>,
      width: "4rem",
      mobileHidden: true,
      cell: (v) => (
        <div className="relative h-10 w-14 overflow-hidden rounded-md bg-muted">
          {v.thumbnailUrl ? (
            <Image
              src={v.thumbnailUrl}
              alt={`${v.make} ${v.model}`}
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Bike className="h-4 w-4" aria-hidden />
            </div>
          )}
        </div>
      ),
    },
    {
      id: "code",
      header: "Code",
      sortable: true,
      primary: true,
      accessor: (v) => v.internalCode,
      cell: (v) => <span className="font-medium">{v.internalCode}</span>,
    },
    {
      id: "vehicle",
      header: "Vehicle",
      sortable: true,
      secondary: true,
      accessor: (v) => `${v.make} ${v.model}`,
      cell: (v) => <span>{v.make} {v.model}</span>,
    },
    {
      id: "rego",
      header: "Rego",
      sortable: true,
      accessor: (v) => v.rego,
      cell: (v) => <span className="tabular-nums">{v.rego}</span>,
    },
    {
      id: "year",
      header: "Year",
      align: "right",
      sortable: true,
      accessor: (v) => v.year,
      cell: (v) => <span className="tabular-nums">{v.year}</span>,
    },
    {
      id: "colour",
      header: "Colour",
      sortable: true,
      mobileHidden: true,
      accessor: (v) => v.colour ?? "",
      cell: (v) => <span className="text-muted-foreground">{v.colour ?? "—"}</span>,
    },
    {
      id: "expiry",
      header: "Rego expiry",
      sortable: true,
      accessor: (v) => v.regoExpiry,
      cell: (v) => (
        <span className="tabular-nums text-muted-foreground">
          {v.regoExpiry ? formatDate(v.regoExpiry) : "—"}
        </span>
      ),
    },
    {
      id: "category",
      header: "Category",
      sortable: true,
      accessor: (v) => v.categoryName,
      cell: (v) => <span className="text-muted-foreground">{v.categoryName}</span>,
    },
    {
      id: "depot",
      header: "Depot",
      sortable: true,
      accessor: (v) => v.depotName,
      cell: (v) => <span className="text-muted-foreground">{v.depotName}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (v) => <StatusBadge status={v.status as StatusKey} />,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DataTable<FleetVehicleRow>
        columns={columns}
        data={pageSlice}
        getRowId={(v) => v.id}
        getRowHref={(v) => `/staff/fleet/vehicles/${v.id}`}
        empty="No vehicles match your filters."
        stickyHeader
        mobileMode="cards"
        className="min-h-0 flex-1"
      />
      <DataTablePagination
        page={clampedPage}
        pageSize={pageSize}
        totalCount={totalCount}
        pageCount={pageCount}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </div>
  );
}
