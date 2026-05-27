"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Award, Banknote, ExternalLink, Gift, Trophy, Users } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { StatShell } from "@/components/ui/stat-shell";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

type LeaderKind = "lifetime" | "points";

const TIER_TONE: Record<"SILVER" | "GOLD" | "PLATINUM", StatusKey> = {
  SILVER: "READY",
  GOLD: "HIGH",
  PLATINUM: "URGENT",
};

interface LoyaltyRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  loyaltyPoints: number;
  lifetimePoints: number;
  loyaltyTier: "SILVER" | "GOLD" | "PLATINUM";
  totalSpend: number;
  completedBookings: number;
  totalBookings: number;
}

function formatAud(n: number): string {
  return n.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  });
}

export function CustomerLoyaltyTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const kind = (searchParams.get("lkind") === "points" ? "points" : "lifetime") as LeaderKind;
  const page = Math.max(1, Number(searchParams.get("lp")) || 1);
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

  const statsQuery = trpc.staffCustomer.loyaltyStats.useQuery();
  const leaderboardQuery = trpc.staffCustomer.loyaltyLeaderboard.useQuery({
    kind,
    page,
    pageSize,
  });
  const referralQuery = trpc.staffCustomer.referralLeaderboard.useQuery({ take: 10 });

  const stats = statsQuery.data;
  const totalTier =
    (stats?.tiers.silver ?? 0) + (stats?.tiers.gold ?? 0) + (stats?.tiers.platinum ?? 0);

  // Pre-compute rank by looking up id position in the rendered page slice;
  // O(1) via Map. DataTable's cell() doesn't expose an index, so this is
  // the cleanest way to render a "1." marker per row.
  const rankById = React.useMemo(() => {
    const m = new Map<string, number>();
    (leaderboardQuery.data?.items ?? []).forEach((r, i) => {
      m.set(r.id, (page - 1) * pageSize + i + 1);
    });
    return m;
  }, [leaderboardQuery.data, page, pageSize]);

  const columns: DataTableColumn<LoyaltyRow>[] = React.useMemo(
    () => [
      {
        id: "rank",
        header: "#",
        width: "3rem",
        cell: (r) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {rankById.get(r.id) ?? ""}
          </span>
        ),
      },
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
        id: "tier",
        header: "Tier",
        cell: (r) => <StatusBadge status={TIER_TONE[r.loyaltyTier]} label={r.loyaltyTier} />,
      },
      {
        id: "points",
        header: kind === "lifetime" ? "Lifetime points" : "Current points",
        align: "right",
        cell: (r) => (
          <span className="font-display text-sm font-semibold tabular-nums">
            {(kind === "lifetime" ? r.lifetimePoints : r.loyaltyPoints).toLocaleString()}
          </span>
        ),
      },
      {
        id: "spend",
        header: "Lifetime spend",
        align: "right",
        cell: (r) => (
          <span className="tabular-nums">{formatAud(r.totalSpend)}</span>
        ),
      },
      {
        id: "bookings",
        header: "Bookings",
        // Completed + in-flight engagements (excludes no-shows/cancellations).
        align: "right",
        cell: (r) => <span className="tabular-nums">{r.totalBookings}</span>,
      },
    ],
    [kind, rankById],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* ── 1. Stats (top, fixed) ───────────────────────────────────── */}
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatShell title="Outstanding points" icon={<Award className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.outstandingPoints ?? 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {(stats?.lifetimePoints ?? 0).toLocaleString()} lifetime issued
          </div>
        </StatShell>
        <StatShell title="Referral credit issued" icon={<Banknote className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {formatAud(stats?.referrals.rewardIssued ?? 0)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {formatAud(stats?.totalCreditBalance ?? 0)} unused balance
          </div>
        </StatShell>
        <StatShell title="Qualified referrals" icon={<Gift className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(stats?.referrals.qualified ?? 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {(stats?.referrals.pending ?? 0).toLocaleString()} pending,{" "}
            {(stats?.referrals.paid ?? 0).toLocaleString()} paid
          </div>
        </StatShell>
        <StatShell title="Loyalty tiers" icon={<Users className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {totalTier.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            S {(stats?.tiers.silver ?? 0).toLocaleString()} · G{" "}
            {(stats?.tiers.gold ?? 0).toLocaleString()} · P{" "}
            {(stats?.tiers.platinum ?? 0).toLocaleString()}
          </div>
        </StatShell>
      </div>

      {/* ── 2. Loyalty members table (middle, scrollable + sticky thead) ── */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="h3">Top loyalty members</h2>
            <p className="text-caption text-muted-foreground">
              Ranked by{" "}
              {kind === "lifetime" ? "lifetime points earned" : "current redeemable balance"}
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={kind === "lifetime" ? "default" : "secondary"}
              onClick={() => setParams({ lkind: null, lp: null })}
            >
              Lifetime
            </Button>
            <Button
              size="sm"
              variant={kind === "points" ? "default" : "secondary"}
              onClick={() => setParams({ lkind: "points", lp: null })}
            >
              Current
            </Button>
          </div>
        </header>

        <DataTable<LoyaltyRow>
          columns={columns}
          data={leaderboardQuery.isLoading ? undefined : (leaderboardQuery.data?.items ?? [])}
          getRowId={(r) => r.id}
          isLoading={leaderboardQuery.isLoading}
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
              No loyalty members yet.
            </div>
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10"
        />

        <div className="shrink-0 border-t px-4 py-2.5">
          <DataTablePagination
            page={leaderboardQuery.data?.page ?? page}
            pageSize={leaderboardQuery.data?.pageSize ?? pageSize}
            totalCount={leaderboardQuery.data?.totalCount ?? 0}
            pageCount={leaderboardQuery.data?.pageCount ?? 1}
            onPageChange={(next) => setParams({ lp: next === 1 ? null : next })}
            onPageSizeChange={() => {}}
          />
        </div>
      </section>

      {/* ── 3. Referral leaderboard (bottom, fixed height) ──────────── */}
      <section className="shrink-0 rounded-lg border bg-card shadow-sm">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="h3">Referral leaderboard</h2>
            <p className="text-caption text-muted-foreground">
              Top 10 referrers ranked by qualified referrals
            </p>
          </div>
          <Trophy className="h-5 w-5 text-muted-foreground" />
        </header>
        <ul className="max-h-64 divide-y overflow-auto">
          {referralQuery.isLoading ? (
            <li className="flex items-center justify-center px-4 py-6"><Spinner /></li>
          ) : (referralQuery.data ?? []).length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No referrals yet.
            </li>
          ) : (
            referralQuery.data?.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30">
                <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/staff/customers/${c.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {c.firstName} {c.lastName}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">{c.email}</div>
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <span className="font-display text-sm font-semibold tabular-nums">
                    {c.qualifiedCount} qualified
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {c.pendingCount} pending · {formatAud(c.creditBalance)} credit
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
