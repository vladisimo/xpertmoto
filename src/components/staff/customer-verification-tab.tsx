"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ExternalLink, IdCard } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatShell, PipelineRow } from "@/components/ui/stat-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

type Bucket = "awaitingReview" | "expiring" | "expired" | "noImages";

const BUCKETS: { value: Bucket; label: string; description: string }[] = [
  { value: "awaitingReview", label: "Awaiting review", description: "Images uploaded — verify identity and stamp licence as verified." },
  { value: "expiring",       label: "Expiring 30d",   description: "Verified, but the licence expires within the next 30 days." },
  { value: "expired",        label: "Expired",         description: "Licence expiry date has already passed." },
  { value: "noImages",       label: "No images",       description: "No licence images on file — chase the customer to upload." },
];

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

interface QueueRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  customerProfile: {
    licenceNumber: string | null;
    licenceState: string | null;
    licenceExpiry: Date | string | null;
    licenceImageFront: string | null;
    licenceImageBack: string | null;
    licenceVerifiedAt: Date | string | null;
    lastBookingAt: Date | string | null;
  } | null;
  _count: { bookings: number };
}

export function CustomerVerificationTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();

  const bucket = (BUCKETS.find((b) => b.value === searchParams.get("bucket"))?.value ??
    "awaitingReview") as Bucket;
  const search = searchParams.get("vq") ?? "";
  const page = Math.max(1, Number(searchParams.get("vp")) || 1);
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

  const funnelQuery = trpc.staffCustomer.verificationFunnel.useQuery();
  const queueQuery = trpc.staffCustomer.verificationQueue.useQuery({
    bucket,
    search: search || undefined,
    page,
    pageSize,
  });

  const verifyMutation = trpc.staffCustomer.verifyLicence.useMutation({
    onSuccess: () => {
      void utils.staffCustomer.verificationQueue.invalidate();
      void utils.staffCustomer.verificationFunnel.invalidate();
      void utils.staffCustomer.stats.invalidate();
    },
    onError: (e) => alert(e.message),
  });

  const f = funnelQuery.data;
  const total = f?.total ?? 0;

  const bucketCount = (b: Bucket): number => {
    if (!f) return 0;
    if (b === "awaitingReview") return f.awaitingReview;
    if (b === "expiring") return f.expiringSoon;
    if (b === "expired") return f.expired;
    return f.noLicenceImages;
  };

  const columns: DataTableColumn<QueueRow>[] = React.useMemo(
    () => [
      {
        id: "name",
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
        id: "licence",
        header: "Licence",
        cell: (r) => {
          const cp = r.customerProfile;
          return (
            <div className="text-sm">
              {cp?.licenceNumber ?? <span className="text-muted-foreground">—</span>}
              {cp?.licenceState ? (
                <span className="ml-1 text-xs text-muted-foreground">{cp.licenceState}</span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "expiry",
        header: "Expiry",
        cell: (r) => {
          const exp = r.customerProfile?.licenceExpiry ?? null;
          const days = daysUntil(exp);
          if (!exp) return <span className="text-muted-foreground">—</span>;
          const tone =
            days != null && days < 0
              ? "URGENT"
              : days != null && days <= 30
              ? "HIGH"
              : "READY";
          return (
            <div className="flex items-center gap-2">
              <span className="text-sm tabular-nums">{formatDate(exp)}</span>
              <StatusBadge
                status={tone}
                label={
                  days != null && days < 0
                    ? `${Math.abs(days)}d ago`
                    : days != null && days <= 30
                    ? `${days}d`
                    : "OK"
                }
              />
            </div>
          );
        },
      },
      {
        id: "verified",
        header: "Verified",
        cell: (r) => {
          const ver = r.customerProfile?.licenceVerifiedAt;
          return ver ? (
            <span className="text-xs tabular-nums text-muted-foreground">{formatDate(ver)}</span>
          ) : (
            <StatusBadge status="LOW" label="No" />
          );
        },
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
        id: "bookings",
        header: "Bookings",
        align: "right",
        cell: (r) => <span className="tabular-nums">{r._count.bookings}</span>,
      },
    ],
    [],
  );

  const rows = (queueQuery.data?.items ?? []) as QueueRow[];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatShell
          title="Total customers"
          icon={<IdCard className="h-4 w-4" />}
        >
          <div className="font-display text-3xl font-semibold tabular-nums">
            {total.toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Awaiting review" icon={<IdCard className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums text-destructive">
            {(f?.awaitingReview ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Expiring 30d" icon={<IdCard className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(f?.expiringSoon ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Expired" icon={<IdCard className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums text-destructive">
            {(f?.expired ?? 0).toLocaleString()}
          </div>
        </StatShell>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Verification funnel
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <PipelineRow
            label="No licence number"
            value={f?.noLicenceNumber ?? 0}
            total={total}
            colorVar="--destructive"
          />
          <PipelineRow
            label="No images uploaded"
            value={f?.noLicenceImages ?? 0}
            total={total}
            colorVar="--muted-foreground"
          />
          <PipelineRow
            label="Awaiting review"
            value={f?.awaitingReview ?? 0}
            total={total}
            colorVar="--primary"
          />
          <PipelineRow
            label="Verified"
            value={f?.verified ?? 0}
            total={total}
            colorVar="--primary"
          />
          <PipelineRow
            label="Expiring 30d"
            value={f?.expiringSoon ?? 0}
            total={total}
            colorVar="--primary"
          />
          <PipelineRow
            label="Expired"
            value={f?.expired ?? 0}
            total={total}
            colorVar="--destructive"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => (
          <Button
            key={b.value}
            variant={bucket === b.value ? "default" : "secondary"}
            size="sm"
            onClick={() => setParams({ bucket: b.value === "awaitingReview" ? null : b.value, vp: null })}
            title={b.description}
          >
            {b.label}
            <span className="ml-1.5 rounded-full bg-background/30 px-1.5 text-[10px] tabular-nums">
              {bucketCount(b.value).toLocaleString()}
            </span>
          </Button>
        ))}
        <div className="ml-auto w-full sm:w-72">
          <Input
            placeholder="Search name, email, phone…"
            value={search}
            onChange={(e) => setParams({ vq: e.target.value || null, vp: null })}
          />
        </div>
      </div>

      <p className="text-caption text-muted-foreground">
        {BUCKETS.find((b) => b.value === bucket)?.description}
      </p>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable<QueueRow>
          columns={columns}
          data={queueQuery.isLoading ? undefined : rows}
          getRowId={(r) => r.id}
          isLoading={queueQuery.isLoading}
          rowActions={(r) => (
            <div className="flex items-center gap-1">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/staff/customers/${r.id}?tab=documents`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Link>
              </Button>
              {!r.customerProfile?.licenceVerifiedAt && (
                <Button
                  variant="default"
                  size="sm"
                  disabled={verifyMutation.isPending}
                  onClick={() =>
                    verifyMutation.mutate({ customerId: r.id, verified: true })
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                  Verify
                </Button>
              )}
            </div>
          )}
          empty={
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No customers in this bucket.
            </div>
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={queueQuery.data?.page ?? page}
            pageSize={queueQuery.data?.pageSize ?? pageSize}
            totalCount={queueQuery.data?.totalCount ?? 0}
            pageCount={queueQuery.data?.pageCount ?? 1}
            onPageChange={(next) => setParams({ vp: next === 1 ? null : next })}
            onPageSizeChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
