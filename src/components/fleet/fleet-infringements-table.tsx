"use client";

import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/utils";

export type FleetInfringementRow = {
  id: string;
  referenceNumber: string;
  type: string;
  issuer: string;
  status: string;
  vehicleCode: string;
  bookingRef: string | null;
  customerName: string | null;
  offenceDate: Date;
  amount: number;
};

export function FleetInfringementsTable({ data }: { data: FleetInfringementRow[] }) {
  const columns: DataTableColumn<FleetInfringementRow>[] = [
    {
      id: "reference",
      header: "Reference",
      sortable: true,
      primary: true,
      accessor: (i) => i.referenceNumber,
      cell: (i) => <span className="font-medium">{i.referenceNumber}</span>,
    },
    {
      id: "type",
      header: "Type",
      secondary: true,
      cell: (i) => <span className="text-muted-foreground">{i.type.replace(/_/g, " ")}</span>,
    },
    {
      id: "issuer",
      header: "Issuer",
      mobileHidden: true,
      cell: (i) => <span className="text-muted-foreground">{i.issuer}</span>,
    },
    {
      id: "vehicle",
      header: "Vehicle",
      cell: (i) => <span>{i.vehicleCode}</span>,
    },
    {
      id: "booking",
      header: "Booking",
      cell: (i) =>
        i.bookingRef ? (
          <div>
            <div>{i.bookingRef}</div>
            <div className="text-xs text-muted-foreground">{i.customerName ?? ""}</div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "offence",
      header: "Offence date",
      sortable: true,
      accessor: (i) => i.offenceDate,
      cell: (i) => (
        <span className="text-muted-foreground">
          {i.offenceDate.toLocaleDateString("en-AU")}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortable: true,
      accessor: (i) => i.amount,
      cell: (i) => <span className="tabular-nums font-medium">{formatCurrency(i.amount)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (i) => <StatusBadge status={i.status as StatusKey} />,
    },
  ];

  return (
    <DataTable<FleetInfringementRow>
      columns={columns}
      data={data}
      getRowId={(i) => i.id}
      empty="No infringements recorded."
      mobileMode="cards"
    />
  );
}
