"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import {
  CustomerFilterBar,
  DEFAULT_STATUS_PRESETS,
  type StatusPreset,
} from "@/components/staff/customer-filter-bar";
import { CustomerStats } from "@/components/staff/customer-stats";
import { CustomersTable, type CustomerRow } from "@/components/staff/customers-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import type { DataTableSortState } from "@/components/ui/data-table";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/customers/filters";

const DEFAULT_STATUS: StatusFilter = "ALL";
const DEFAULT_PAGE_SIZE = 25;

function parseStatus(value: string | null): StatusFilter {
  if (value && (STATUS_FILTERS as readonly string[]).includes(value)) {
    return value as StatusFilter;
  }
  return DEFAULT_STATUS;
}

function parsePageSize(value: string | null): number {
  const n = Number(value);
  return [25, 50, 100].includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseSort(value: string | null): DataTableSortState | null {
  if (!value) return null;
  const [id, dir] = value.split(":");
  if (!id || (dir !== "asc" && dir !== "desc")) return null;
  if (!["name", "bookings", "createdAt"].includes(id)) return null;
  return { id, dir };
}

export function CustomersClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = parseStatus(searchParams.get("status"));
  const search = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = parsePageSize(searchParams.get("size"));
  const sort = parseSort(searchParams.get("sort"));

  const setParams = React.useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === undefined) next.delete(key);
        else next.set(key, String(value));
      }
      router.replace(`/staff/customers?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const listInput = React.useMemo(
    () => ({
      status,
      search: search || undefined,
      page,
      pageSize,
      sortBy: (sort?.id ?? "createdAt") as "name" | "bookings" | "createdAt",
      sortDir: (sort?.dir ?? "desc") as "asc" | "desc",
    }),
    [status, search, page, pageSize, sort],
  );

  const listQuery = trpc.staffCustomer.list.useQuery(listInput);
  const statsQuery = trpc.staffCustomer.stats.useQuery();

  const rows: CustomerRow[] = React.useMemo(
    () =>
      (listQuery.data?.items ?? []).map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        status: u.status,
        bookingCount: u._count.bookings,
        licenceVerified: !!u.customerProfile?.licenceVerifiedAt,
        riskRating: u.customerProfile?.riskRating ?? null,
      })),
    [listQuery.data],
  );

  const presets: StatusPreset[] = React.useMemo(() => {
    const s = statsQuery.data;
    if (!s) return DEFAULT_STATUS_PRESETS;
    const counts: Record<StatusFilter, number | undefined> = {
      ALL: s.total,
      PENDING_HIRE: s.pendingHire,
      ACTIVE_RENTAL: s.activeRental,
      UNVERIFIED: s.unverified,
      LICENCE_EXPIRED: s.licenceExpired,
      HIGH_RISK: s.risk.high,
      SUSPENDED: s.suspended,
    };
    return DEFAULT_STATUS_PRESETS.map((p) => ({ ...p, count: counts[p.value] }));
  }, [statsQuery.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <CustomerStats data={statsQuery.data} loading={statsQuery.isLoading} />

      <CustomerFilterBar
        status={status}
        search={search}
        presets={presets}
        isFetching={listQuery.isFetching}
        onStatusChange={(next) =>
          setParams({ status: next === DEFAULT_STATUS ? null : next, page: null })
        }
        onSearchChange={(next) => setParams({ q: next || null, page: null })}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden md:gap-0 md:rounded-md md:border md:bg-card md:shadow-sm">
        <CustomersTable
          data={listQuery.isLoading ? undefined : rows}
          isLoading={listQuery.isLoading}
          sort={sort}
          onSortChange={(next) =>
            setParams({
              sort: next ? `${next.id}:${next.dir}` : null,
              page: null,
            })
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />
        <div className="shrink-0 px-1 py-2 md:border-t md:px-4 md:py-2.5">
          <DataTablePagination
            page={listQuery.data?.page ?? page}
            pageSize={listQuery.data?.pageSize ?? pageSize}
            totalCount={listQuery.data?.totalCount ?? 0}
            pageCount={listQuery.data?.pageCount ?? 1}
            onPageChange={(next) => setParams({ page: next === 1 ? null : next })}
            onPageSizeChange={(next) =>
              setParams({ size: next === DEFAULT_PAGE_SIZE ? null : next, page: null })
            }
          />
        </div>
      </div>
    </div>
  );
}
