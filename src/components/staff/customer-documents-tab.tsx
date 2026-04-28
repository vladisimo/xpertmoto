"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { StatShell } from "@/components/ui/stat-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

type Mode = "expiring" | "missing";
type ExpiringKind = "all" | "licence" | "passport";
type MissingRequirement = "licenceImages" | "signature" | "emergency" | "address" | "terms";

const MISSING_LABEL: Record<MissingRequirement, string> = {
  licenceImages: "Licence images",
  signature: "Signature",
  emergency: "Emergency contact",
  address: "Address",
  terms: "T&Cs accepted",
};

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

interface ExpiringRow {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  documentType: string;
  documentLabel: string;
  expiryDate: Date | string;
  daysUntil: number;
  source: "profile" | "document";
}

interface MissingRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  customerProfile: {
    customerSince: Date | string;
    lastBookingAt: Date | string | null;
    totalBookings: number;
  } | null;
}

export function CustomerDocumentsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode = (searchParams.get("dmode") as Mode) === "missing" ? "missing" : "expiring";
  const kind = (searchParams.get("dkind") as ExpiringKind) ?? "all";
  const requirement = (searchParams.get("dreq") as MissingRequirement) ?? "licenceImages";
  const windowDays = Number(searchParams.get("dwin")) || 60;
  const page = Math.max(1, Number(searchParams.get("dp")) || 1);
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

  const statsQuery = trpc.staffCustomer.documentStats.useQuery();
  const expiringQuery = trpc.staffCustomer.expiringDocuments.useQuery(
    { kind, windowDays, page, pageSize },
    { enabled: mode === "expiring" },
  );
  const missingQuery = trpc.staffCustomer.missingDocuments.useQuery(
    { requirement, page, pageSize },
    { enabled: mode === "missing" },
  );

  const stats = statsQuery.data;

  const expiringColumns: DataTableColumn<ExpiringRow>[] = React.useMemo(
    () => [
      {
        id: "customer",
        header: "Customer",
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
        id: "doc",
        header: "Document",
        cell: (r) => (
          <div>
            <div className="text-sm capitalize">{r.documentLabel}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {r.source === "profile" ? "Profile" : "Document"}
            </div>
          </div>
        ),
      },
      {
        id: "expiry",
        header: "Expiry",
        cell: (r) => (
          <span className="text-sm tabular-nums">{formatDate(r.expiryDate)}</span>
        ),
      },
      {
        id: "until",
        header: "When",
        cell: (r) => {
          const tone = r.daysUntil <= 14 ? "URGENT" : r.daysUntil <= 30 ? "HIGH" : "READY";
          return <StatusBadge status={tone} label={`in ${r.daysUntil}d`} />;
        },
      },
    ],
    [],
  );

  const missingColumns: DataTableColumn<MissingRow>[] = React.useMemo(
    () => [
      {
        id: "customer",
        header: "Customer",
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
        cell: (r) => r.phone ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "lastBooking",
        header: "Last booking",
        cell: (r) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDate(r.customerProfile?.lastBookingAt)}
          </span>
        ),
      },
      {
        id: "totalBookings",
        header: "Bookings",
        align: "right",
        cell: (r) => (
          <span className="tabular-nums">{r.customerProfile?.totalBookings ?? 0}</span>
        ),
      },
    ],
    [],
  );

  const isLoading = mode === "expiring" ? expiringQuery.isLoading : missingQuery.isLoading;
  const data = mode === "expiring" ? expiringQuery.data : missingQuery.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatShell title="Licences expiring 30d" icon={<FileText className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.licencesExpiring30d ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Passports expiring 90d" icon={<FileText className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.passportsExpiring90d ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="No licence images" icon={<FileText className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.missingLicenceImages ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="No signature" icon={<FileText className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.missingSignature ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="No T&Cs accepted" icon={<FileText className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.missingTerms ?? 0).toLocaleString()}
          </div>
        </StatShell>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={mode === "expiring" ? "default" : "secondary"}
          size="sm"
          onClick={() => setParams({ dmode: null, dp: null })}
        >
          Expiring documents
        </Button>
        <Button
          variant={mode === "missing" ? "default" : "secondary"}
          size="sm"
          onClick={() => setParams({ dmode: "missing", dp: null })}
        >
          Missing documents
        </Button>

        {mode === "expiring" ? (
          <>
            <Select
              value={kind}
              onValueChange={(v) => setParams({ dkind: v === "all" ? null : v, dp: null })}
            >
              <SelectTrigger className="w-[12rem]">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All documents</SelectItem>
                <SelectItem value="licence">Licence + IDP</SelectItem>
                <SelectItem value="passport">Passport / visa</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(windowDays)}
              onValueChange={(v) => setParams({ dwin: v === "60" ? null : v, dp: null })}
            >
              <SelectTrigger className="w-[10rem]">
                <SelectValue placeholder="Window" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="14">Within 14d</SelectItem>
                <SelectItem value="30">Within 30d</SelectItem>
                <SelectItem value="60">Within 60d</SelectItem>
                <SelectItem value="90">Within 90d</SelectItem>
              </SelectContent>
            </Select>
          </>
        ) : (
          <Select
            value={requirement}
            onValueChange={(v) =>
              setParams({ dreq: v === "licenceImages" ? null : v, dp: null })
            }
          >
            <SelectTrigger className="w-[16rem]">
              <SelectValue placeholder="Requirement" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MISSING_LABEL) as MissingRequirement[]).map((k) => (
                <SelectItem key={k} value={k}>
                  Missing {MISSING_LABEL[k].toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        {mode === "expiring" ? (
          <DataTable<ExpiringRow>
            columns={expiringColumns}
            data={isLoading ? undefined : (expiringQuery.data?.items ?? [])}
            getRowId={(r) => `${r.customerId}:${r.documentType}`}
            isLoading={isLoading}
            rowActions={(r) => (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/staff/customers/${r.customerId}?tab=documents`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Link>
              </Button>
            )}
            empty={
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                No documents expiring in this window.
              </div>
            }
            className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
          />
        ) : (
          <DataTable<MissingRow>
            columns={missingColumns}
            data={isLoading ? undefined : (missingQuery.data?.items as MissingRow[] | undefined)}
            getRowId={(r) => r.id}
            isLoading={isLoading}
            rowActions={(r) => (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/staff/customers/${r.id}`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Link>
              </Button>
            )}
            empty={
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                No customers missing this requirement.
              </div>
            }
            className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
          />
        )}
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={data?.page ?? page}
            pageSize={data?.pageSize ?? pageSize}
            totalCount={data?.totalCount ?? 0}
            pageCount={data?.pageCount ?? 1}
            onPageChange={(next) => setParams({ dp: next === 1 ? null : next })}
            onPageSizeChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
