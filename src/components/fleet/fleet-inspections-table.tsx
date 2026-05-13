"use client";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";

export type FleetInspectionRow = {
  id: string;
  vehicleCode: string;
  type: string;
  inspectorName: string;
  dateTime: Date;
  odometerKm: number;
  fuelLevel: number;
  overallCondition: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
};

export function FleetInspectionsTable({ data }: { data: FleetInspectionRow[] }) {
  const columns: DataTableColumn<FleetInspectionRow>[] = [
    {
      id: "vehicle",
      header: "Vehicle",
      sortable: true,
      primary: true,
      accessor: (i) => i.vehicleCode,
      cell: (i) => <span className="font-medium">{i.vehicleCode}</span>,
    },
    {
      id: "type",
      header: "Type",
      secondary: true,
      cell: (i) => <span className="text-muted-foreground">{i.type.replace(/_/g, " ")}</span>,
    },
    {
      id: "inspector",
      header: "Inspector",
      mobileHidden: true,
      cell: (i) => <span className="text-muted-foreground">{i.inspectorName}</span>,
    },
    {
      id: "date",
      header: "Date",
      sortable: true,
      accessor: (i) => i.dateTime,
      cell: (i) => <span className="text-muted-foreground">{formatDateTime(i.dateTime)}</span>,
    },
    {
      id: "odometer",
      header: "Odo",
      align: "right",
      sortable: true,
      accessor: (i) => i.odometerKm,
      cell: (i) => <span className="tabular-nums text-muted-foreground">{i.odometerKm.toLocaleString()}</span>,
    },
    {
      id: "fuel",
      header: "Fuel",
      align: "right",
      cell: (i) => <span className="tabular-nums text-muted-foreground">{i.fuelLevel}%</span>,
    },
    {
      id: "condition",
      header: "Condition",
      cell: (i) => <StatusBadge status={i.overallCondition} />,
    },
  ];

  return (
    <DataTable<FleetInspectionRow>
      columns={columns}
      data={data}
      getRowId={(i) => i.id}
      empty="No inspections yet."
      mobileMode="cards"
    />
  );
}
