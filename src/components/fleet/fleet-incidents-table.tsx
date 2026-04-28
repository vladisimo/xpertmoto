"use client";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export type FleetIncidentRow = {
  id: string;
  incidentNumber: string;
  type: string;
  severity: string;
  status: string;
  vehicleCode: string;
  customerName: string | null;
  dateTime: Date;
  description: string;
  estimatedDamageCost: number | null;
};

export function FleetIncidentsTable({ data }: { data: FleetIncidentRow[] }) {
  const columns: DataTableColumn<FleetIncidentRow>[] = [
    {
      id: "number",
      header: "Incident",
      sortable: true,
      accessor: (i) => i.incidentNumber,
      cell: (i) => <span className="font-medium">{i.incidentNumber}</span>,
    },
    {
      id: "type",
      header: "Type",
      cell: (i) => <span className="text-muted-foreground">{i.type.replace(/_/g, " ")}</span>,
    },
    {
      id: "severity",
      header: "Severity",
      cell: (i) => <StatusBadge status={i.severity as StatusKey} />,
    },
    {
      id: "vehicle",
      header: "Vehicle",
      cell: (i) => <span>{i.vehicleCode}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (i) => (
        <span className="text-muted-foreground">
          {i.customerName ?? "—"}
        </span>
      ),
    },
    {
      id: "date",
      header: "Date",
      sortable: true,
      accessor: (i) => i.dateTime,
      cell: (i) => <span className="text-muted-foreground">{formatDateTime(i.dateTime)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (i) => <StatusBadge status={i.status as StatusKey} />,
    },
    {
      id: "cost",
      header: "Estimate",
      align: "right",
      sortable: true,
      accessor: (i) => i.estimatedDamageCost ?? 0,
      cell: (i) =>
        i.estimatedDamageCost ? (
          <span className="tabular-nums">{formatCurrency(i.estimatedDamageCost)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <DataTable<FleetIncidentRow>
      columns={columns}
      data={data}
      getRowId={(i) => i.id}
      getRowHref={(i) => `/staff/incidents/${i.id}`}
      empty="No incidents recorded."
    />
  );
}
