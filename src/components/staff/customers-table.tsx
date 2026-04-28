"use client";

import Link from "next/link";
import { Eye, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
} from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

export type CustomerRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  bookingCount: number;
  licenceVerified: boolean;
  riskRating: string | null;
};

const RISK_CLASSES: Record<string, string> = {
  HIGH: "text-destructive",
  MEDIUM: "text-secondary",
  LOW: "text-muted-foreground",
};

export function CustomersTable({
  data,
  isLoading,
  sort,
  onSortChange,
  className,
}: {
  data: CustomerRow[] | undefined;
  isLoading?: boolean;
  sort?: DataTableSortState | null;
  onSortChange?: (sort: DataTableSortState | null) => void;
  className?: string;
}) {
  const columns: DataTableColumn<CustomerRow>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      primary: true,
      accessor: (r) => `${r.firstName} ${r.lastName}`.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">
            {r.firstName} {r.lastName}
          </div>
          <div className="truncate text-xs text-muted-foreground">{r.email}</div>
        </div>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      secondary: true,
      cell: (r) => <span className="text-muted-foreground">{r.phone ?? "—"}</span>,
    },
    {
      id: "bookings",
      header: "Bookings",
      align: "right",
      sortable: true,
      accessor: (r) => r.bookingCount,
      cell: (r) => <span className="tabular-nums">{r.bookingCount}</span>,
    },
    {
      id: "licence",
      header: "Licence",
      cell: (r) =>
        r.licenceVerified ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            Unverified
          </span>
        ),
    },
    {
      id: "risk",
      header: "Risk",
      cell: (r) =>
        r.riskRating ? (
          <span className={cn("text-xs font-medium", RISK_CLASSES[r.riskRating] ?? "text-muted-foreground")}>
            {r.riskRating}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status as StatusKey} />,
    },
  ];

  return (
    <DataTable<CustomerRow>
      columns={columns}
      data={data}
      isLoading={isLoading}
      mobileMode="cards"
      getRowId={(r) => r.id}
      getRowHref={(r) => `/staff/customers/${r.id}`}
      empty="No customers match your filters."
      sort={sort}
      onSortChange={onSortChange}
      className={className}
      rowActions={(r) => (
        <Button asChild size="sm" variant="secondary" className="hidden md:inline-flex">
          <Link href={`/staff/customers/${r.id}`}>
            <Eye className="h-3.5 w-3.5" />
            View
          </Link>
        </Button>
      )}
    />
  );
}
