"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Ban, ExternalLink, Shield, ShieldAlert, ShieldX } from "lucide-react";
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
import { StatShell } from "@/components/ui/stat-shell";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  CustomerBlacklistSheet,
  type BlacklistTarget,
} from "./customer-blacklist-sheet";

type Bucket = "all" | "high" | "medium" | "blacklisted" | "repeatIncidents" | "suspended";
type Rating = "LOW" | "MEDIUM" | "HIGH";

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: "all",             label: "All risk"       },
  { value: "high",            label: "HIGH"           },
  { value: "medium",          label: "MEDIUM"         },
  { value: "blacklisted",     label: "Blacklisted"    },
  { value: "repeatIncidents", label: "Repeat incidents" },
  { value: "suspended",       label: "Suspended"      },
];

const RATING_TONE: Record<Rating, StatusKey> = {
  LOW: "READY",
  MEDIUM: "HIGH",
  HIGH: "URGENT",
};

interface RiskRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  customerProfile: {
    riskRating: Rating;
    blacklistReason: string | null;
    incidentCount: number;
    lastBookingAt: Date | string | null;
    notes: string | null;
  } | null;
  _count: { bookings: number };
}

function bucketToInput(bucket: Bucket): {
  rating?: Rating;
  blacklisted?: boolean;
  minIncidents?: number;
  suspended?: boolean;
} {
  switch (bucket) {
    case "high":            return { rating: "HIGH" };
    case "medium":          return { rating: "MEDIUM" };
    case "blacklisted":     return { blacklisted: true };
    case "repeatIncidents": return { minIncidents: 2 };
    case "suspended":       return { suspended: true };
    case "all":             return {};
  }
}

export function CustomerRiskTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();

  const bucket = (BUCKETS.find((b) => b.value === searchParams.get("rbucket"))?.value ?? "high") as Bucket;
  const search = searchParams.get("rq") ?? "";
  const page = Math.max(1, Number(searchParams.get("rp")) || 1);
  const pageSize = 25;

  const setParams = React.useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === undefined) next.delete(k);
        else next.set(k, String(v));
      }
      router.replace(`/staff/customers?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const statsQuery = trpc.staffCustomer.riskStats.useQuery();
  const listQuery = trpc.staffCustomer.riskList.useQuery({
    ...bucketToInput(bucket),
    search: search || undefined,
    page,
    pageSize,
  });

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkRating, setBulkRating] = React.useState<Rating>("MEDIUM");
  const [blacklistTarget, setBlacklistTarget] = React.useState<BlacklistTarget | null>(null);

  const bulkMutation = trpc.staffCustomer.bulkSetRiskRating.useMutation({
    onSuccess: ({ updated }) => {
      void utils.staffCustomer.riskList.invalidate();
      void utils.staffCustomer.riskStats.invalidate();
      void utils.staffCustomer.stats.invalidate();
      setSelected(new Set());
      alert(`Updated ${updated} customer${updated === 1 ? "" : "s"}.`);
    },
    onError: (e) => alert(e.message),
  });

  const stats = statsQuery.data;
  const rows = (listQuery.data?.items ?? []) as RiskRow[];

  const allSelectedOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columns: DataTableColumn<RiskRow>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: (
          <input
            type="checkbox"
            checked={allSelectedOnPage}
            onChange={toggleAll}
            aria-label="Select all on page"
          />
        ),
        width: "2.5rem",
        cell: (r) => (
          <input
            type="checkbox"
            checked={selected.has(r.id)}
            onChange={() => toggleOne(r.id)}
            aria-label={`Select ${r.firstName} ${r.lastName}`}
          />
        ),
      },
      {
        id: "customer",
        header: "Customer",
        cell: (r) => (
          <div className="min-w-0">
            <div className="font-medium">{r.firstName} {r.lastName}</div>
            <div className="truncate text-xs text-muted-foreground">{r.email}</div>
          </div>
        ),
      },
      {
        id: "rating",
        header: "Risk",
        cell: (r) => {
          const rating = r.customerProfile?.riskRating ?? "LOW";
          return <StatusBadge status={RATING_TONE[rating]} label={rating} />;
        },
      },
      {
        id: "blacklist",
        header: "Blacklist",
        cell: (r) =>
          r.customerProfile?.blacklistReason ? (
            <span className="line-clamp-1 max-w-[16rem] text-xs text-destructive" title={r.customerProfile.blacklistReason}>
              {r.customerProfile.blacklistReason}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "incidents",
        header: "Incidents",
        align: "right",
        cell: (r) => <span className="tabular-nums">{r.customerProfile?.incidentCount ?? 0}</span>,
      },
      {
        id: "bookings",
        header: "Bookings",
        align: "right",
        cell: (r) => <span className="tabular-nums">{r._count.bookings}</span>,
      },
      {
        id: "status",
        header: "Account",
        cell: (r) => <StatusBadge status={r.status === "SUSPENDED" ? "URGENT" : r.status === "BANNED" ? "URGENT" : "READY"} label={r.status} />,
      },
    ],
    [selected, allSelectedOnPage, rows], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatShell title="HIGH risk" icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums text-destructive">
            {(stats?.riskHigh ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="MEDIUM risk" icon={<Shield className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.riskMedium ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Blacklisted" icon={<Ban className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums text-destructive">
            {(stats?.blacklisted ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Repeat incidents" icon={<AlertTriangle className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.repeatIncidents ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Suspended" icon={<ShieldX className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.suspended ?? 0).toLocaleString()}
          </div>
        </StatShell>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => (
          <Button
            key={b.value}
            variant={bucket === b.value ? "default" : "secondary"}
            size="sm"
            onClick={() => setParams({ rbucket: b.value === "high" ? null : b.value, rp: null })}
          >
            {b.label}
          </Button>
        ))}
        <div className="ml-auto w-full sm:w-72">
          <Input
            placeholder="Search name, email, phone…"
            value={search}
            onChange={(e) => setParams({ rq: e.target.value || null, rp: null })}
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground">→</span>
          <Select value={bulkRating} onValueChange={(v) => setBulkRating(v as Rating)}>
            <SelectTrigger className="w-[10rem]">
              <SelectValue placeholder="Risk" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LOW">LOW</SelectItem>
              <SelectItem value="MEDIUM">MEDIUM</SelectItem>
              <SelectItem value="HIGH">HIGH</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={bulkMutation.isPending}
            onClick={() =>
              bulkMutation.mutate({
                customerIds: Array.from(selected),
                riskRating: bulkRating,
              })
            }
          >
            Apply rating
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable<RiskRow>
          columns={columns}
          data={listQuery.isLoading ? undefined : rows}
          getRowId={(r) => r.id}
          isLoading={listQuery.isLoading}
          rowActions={(r) => (
            <div className="flex items-center gap-1">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/staff/customers/${r.id}`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Link>
              </Button>
              <Button
                variant={r.customerProfile?.blacklistReason ? "destructive" : "secondary"}
                size="sm"
                onClick={() =>
                  setBlacklistTarget({
                    customerId: r.id,
                    customerName: `${r.firstName} ${r.lastName}`,
                    currentReason: r.customerProfile?.blacklistReason ?? null,
                  })
                }
              >
                <Ban className="h-3.5 w-3.5" />
                {r.customerProfile?.blacklistReason ? "Update" : "Blacklist"}
              </Button>
            </div>
          )}
          empty={
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No customers in this segment.
            </div>
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={listQuery.data?.page ?? page}
            pageSize={listQuery.data?.pageSize ?? pageSize}
            totalCount={listQuery.data?.totalCount ?? 0}
            pageCount={listQuery.data?.pageCount ?? 1}
            onPageChange={(next) => setParams({ rp: next === 1 ? null : next })}
            onPageSizeChange={() => {}}
          />
        </div>
      </div>

      <CustomerBlacklistSheet
        target={blacklistTarget}
        onClose={() => setBlacklistTarget(null)}
      />
    </div>
  );
}
