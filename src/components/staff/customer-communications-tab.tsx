"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Ban,
  ExternalLink,
  Mail,
  MailX,
  MessageSquare,
  MessageSquareOff,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { StatShell } from "@/components/ui/stat-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

type SuppressionKind = "email" | "sms" | "bounced";

const KINDS: { value: SuppressionKind; label: string }[] = [
  { value: "email",   label: "Email unsubscribes" },
  { value: "sms",     label: "SMS unsubscribes" },
  { value: "bounced", label: "Hard bounces" },
];

interface SuppressionRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  lastEventAt: Date | string | null;
  reason?: string | null;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

export function CustomerCommunicationsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const kind = ((KINDS.find((k) => k.value === searchParams.get("ckind"))?.value) ?? "email") as SuppressionKind;
  const page = Math.max(1, Number(searchParams.get("cp")) || 1);
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

  const consentQuery = trpc.staffCustomer.consentStats.useQuery();
  const suppressionQuery = trpc.staffCustomer.suppressionList.useQuery({ kind, page, pageSize });

  const stats = consentQuery.data;

  const columns: DataTableColumn<SuppressionRow>[] = React.useMemo(
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
        id: "lastEvent",
        header: kind === "bounced" ? "Last bounce" : "Unsubscribed at",
        cell: (r) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDate(r.lastEventAt)}
          </span>
        ),
      },
      ...(kind !== "bounced"
        ? [
            {
              id: "reason",
              header: "Reason",
              cell: (r: SuppressionRow) =>
                r.reason ? (
                  <span className="line-clamp-1 max-w-[24rem] text-xs text-muted-foreground">
                    {r.reason}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            } as DataTableColumn<SuppressionRow>,
          ]
        : []),
    ],
    [kind],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatShell title="Email opt-in" icon={<Mail className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.emailOptIn ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="SMS opt-in" icon={<MessageSquare className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.smsOptIn ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Email unsubs" icon={<MailX className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.emailUnsubs ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="SMS unsubs" icon={<MessageSquareOff className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.smsUnsubs ?? 0).toLocaleString()}
          </div>
        </StatShell>
        <StatShell title="Hard bounces" icon={<Ban className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums text-destructive">
            {(stats?.hardBounces ?? 0).toLocaleString()}
          </div>
        </StatShell>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-sm">
        <div className="text-sm">
          <div className="font-medium">Need to broadcast or build a segment?</div>
          <div className="text-caption text-muted-foreground">
            Campaign composition, segment management and template editing live in the
            communications surface.
          </div>
        </div>
        <Button asChild>
          <Link href="/staff/communications">
            Open /staff/communications
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <Button
            key={k.value}
            variant={kind === k.value ? "default" : "secondary"}
            size="sm"
            onClick={() => setParams({ ckind: k.value === "email" ? null : k.value, cp: null })}
          >
            {k.label}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-sm">
        <DataTable<SuppressionRow>
          columns={columns}
          data={suppressionQuery.isLoading ? undefined : (suppressionQuery.data?.items ?? [])}
          getRowId={(r) => r.id}
          isLoading={suppressionQuery.isLoading}
          rowActions={(r) => (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/staff/customers/${r.id}?tab=personal`}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Link>
            </Button>
          )}
          empty={
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              {kind === "bounced"
                ? "No bounces recorded — every recent send delivered."
                : "No customers in this suppression bucket."}
            </div>
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />
        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={suppressionQuery.data?.page ?? page}
            pageSize={suppressionQuery.data?.pageSize ?? pageSize}
            totalCount={suppressionQuery.data?.totalCount ?? 0}
            pageCount={suppressionQuery.data?.pageCount ?? 1}
            onPageChange={(next) => setParams({ cp: next === 1 ? null : next })}
            onPageSizeChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
