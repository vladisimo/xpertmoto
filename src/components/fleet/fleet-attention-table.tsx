"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
} from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { PageSection } from "@/components/layout/page-section";

const DEFAULT_PAGE_SIZE = 25;

type SortId = "dueDate" | "internalCode" | "issue";

type AttentionRow = {
  id: string;
  vehicleId: string;
  internalCode: string;
  categoryName: string;
  depotName: string;
  issueLabel: string;
  dueDate: Date;
};

function parsePageSize(value: string | null): number {
  const n = Number(value);
  return [25, 50, 100].includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseSort(value: string | null): DataTableSortState | null {
  if (!value) return null;
  const [id, dir] = value.split(":");
  if (!id || (dir !== "asc" && dir !== "desc")) return null;
  if (!["dueDate", "internalCode", "issue"].includes(id)) return null;
  return { id, dir };
}

export function FleetAttentionTable() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const page = Math.max(1, Number(searchParams.get("aPage")) || 1);
  const pageSize = parsePageSize(searchParams.get("aSize"));
  const sort = parseSort(searchParams.get("aSort")) ?? { id: "dueDate", dir: "asc" };

  const setParams = React.useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === undefined) next.delete(key);
        else next.set(key, String(value));
      }
      router.replace(`/staff/fleet?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const query = trpc.fleet.attentionList.useQuery(
    {
      page,
      pageSize,
      sortBy: sort.id as SortId,
      sortDir: sort.dir,
    },
    { staleTime: 30_000 },
  );

  const rows: AttentionRow[] = (query.data?.items ?? []).map((r) => ({
    id: r.id,
    vehicleId: r.vehicleId,
    internalCode: r.internalCode,
    categoryName: r.categoryName,
    depotName: r.depotName,
    issueLabel: r.issueLabel,
    dueDate: new Date(r.dueDate),
  }));

  const columns: DataTableColumn<AttentionRow>[] = [
    {
      id: "internalCode",
      header: "Vehicle",
      sortable: true,
      accessor: (r) => r.internalCode,
      cell: (r) => <span className="font-medium">{r.internalCode}</span>,
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => <span className="text-muted-foreground">{r.categoryName}</span>,
    },
    {
      id: "depot",
      header: "Depot",
      cell: (r) => <span className="text-muted-foreground">{r.depotName}</span>,
    },
    {
      id: "issue",
      header: "Issue",
      sortable: true,
      accessor: (r) => r.issueLabel,
      cell: (r) => <span>{r.issueLabel}</span>,
    },
    {
      id: "dueDate",
      header: "Due",
      align: "right",
      sortable: true,
      accessor: (r) => r.dueDate,
      cell: (r) => (
        <span className="tabular-nums text-destructive">
          {r.dueDate.toLocaleDateString("en-AU")}
        </span>
      ),
    },
  ];

  return (
    <PageSection title="Needing attention" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable<AttentionRow>
          columns={columns}
          data={query.isLoading ? undefined : rows}
          isLoading={query.isLoading}
          getRowId={(r) => r.id}
          getRowHref={(r) => `/staff/fleet/vehicles/${r.vehicleId}`}
          empty="Nothing needs attention right now."
          sort={sort}
          onSortChange={(next) =>
            setParams({
              aSort: next ? `${next.id}:${next.dir}` : null,
              aPage: null,
            })
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={query.data?.page ?? page}
            pageSize={query.data?.pageSize ?? pageSize}
            totalCount={query.data?.totalCount ?? 0}
            pageCount={query.data?.pageCount ?? 1}
            emptyLabel="Nothing needs attention"
            onPageChange={(next) => setParams({ aPage: next === 1 ? null : next })}
            onPageSizeChange={(next) =>
              setParams({ aSize: next === DEFAULT_PAGE_SIZE ? null : next, aPage: null })
            }
          />
        </div>
      </div>
    </PageSection>
  );
}
