"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { StatShell } from "@/components/ui/stat-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";

function formatAud(n: number): string {
  return n.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  });
}

function formatPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const TREND_YEAR_COLORS = [
  "hsl(var(--muted-foreground) / 0.3)",
  "hsl(var(--muted-foreground) / 0.6)",
  "hsl(var(--primary) / 0.55)",
  "hsl(var(--primary))",
];

export function CustomerOverviewTab() {
  const overviewQuery = trpc.staffCustomer.overviewStats.useQuery();
  const trendQuery = trpc.staffCustomer.acquisitionTrend.useQuery({ months: 48 });
  const topSpendersQuery = trpc.staffCustomer.topSpenders.useQuery({ take: 10 });
  const geoQuery = trpc.staffCustomer.geoDistribution.useQuery({ take: 6 });
  const mixQuery = trpc.staffCustomer.customerMixDistribution.useQuery();

  const o = overviewQuery.data;
  const verifiedShare = o && o.total > 0 ? o.verified / o.total : 0;

  const trendYears = React.useMemo(() => {
    const currentYear = new Date().getFullYear();
    return [currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
  }, []);

  const trendData = React.useMemo(() => {
    const byKey = new Map((trendQuery.data ?? []).map((p) => [p.month, p.count]));
    return MONTH_LABELS.map((label, idx) => {
      const row: Record<string, string | number> = { label };
      const mm = String(idx + 1).padStart(2, "0");
      for (const y of trendYears) {
        row[String(y)] = byKey.get(`${y}-${mm}`) ?? 0;
      }
      return row;
    });
  }, [trendQuery.data, trendYears]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatShell title="Total customers" icon={<Users className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {(o?.total ?? 0).toLocaleString()}
          </div>
        </StatShell>

        <StatShell title="New (30d)" icon={<Sparkles className="h-4 w-4" />}>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tabular-nums">
              {(o?.newLast30d ?? 0).toLocaleString()}
            </span>
            {o?.momDelta != null && (
              <span
                className={`inline-flex items-center text-xs ${
                  o.momDelta >= 0 ? "text-foreground" : "text-destructive"
                }`}
              >
                {o.momDelta >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {formatPct(Math.abs(o.momDelta))}
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            vs prior 30d ({(o?.newPrev30d ?? 0).toLocaleString()})
          </div>
        </StatShell>

        <StatShell title="Verified" icon={<UserCheck className="h-4 w-4" />}>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold tabular-nums">
              {(o?.verified ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatPct(verifiedShare, 0)}
            </span>
          </div>
        </StatShell>

        <StatShell title="HIGH risk" icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums text-destructive">
            {(o?.highRisk ?? 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {(o?.blacklisted ?? 0).toLocaleString()} blacklisted
          </div>
        </StatShell>

        <StatShell title="Avg lifetime value" icon={<TrendingUp className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {formatAud(o?.avgLifetimeValue ?? 0)}
          </div>
        </StatShell>

        <StatShell title="Total revenue" icon={<Banknote className="h-4 w-4" />}>
          <div className="font-display text-3xl font-semibold tabular-nums">
            {formatAud(o?.totalLifetimeRevenue ?? 0)}
          </div>
        </StatShell>
      </div>

      <section className="rounded-lg border bg-card shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="h3">Acquisition trend</h2>
            <p className="text-caption text-muted-foreground">
              New customers per month across the last 4 years — compare seasonality year-over-year
            </p>
          </div>
          <ul className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {trendYears.map((y, i) => (
              <li key={y} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: TREND_YEAR_COLORS[i] }}
                />
                <span className="tabular-nums text-foreground">{y}</span>
              </li>
            ))}
          </ul>
        </header>
        <div className="px-2 pb-2 pt-3" style={{ height: 188 }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 188 }}>
            <BarChart data={trendData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={32}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.375rem",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              {trendYears.map((y, i) => (
                <Bar
                  key={y}
                  dataKey={String(y)}
                  name={String(y)}
                  fill={TREND_YEAR_COLORS[i]}
                  radius={[3, 3, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border bg-card shadow-sm lg:row-span-2">
          <header className="border-b px-4 py-3">
            <h2 className="h3">Top spenders</h2>
            <p className="text-caption text-muted-foreground">
              Lifetime spend across all bookings
            </p>
          </header>
          <ul className="divide-y">
            {topSpendersQuery.isLoading ? (
              <li className="flex items-center justify-center px-4 py-6"><Spinner /></li>
            ) : (topSpendersQuery.data ?? []).length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No customers with recorded spend yet.
              </li>
            ) : (
              topSpendersQuery.data?.map((c, i) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30"
                >
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
                      {formatAud(c.totalSpend)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {c.totalBookings} {c.totalBookings === 1 ? "booking" : "bookings"}
                    </span>
                  </div>
                  <StatusBadge
                    status={
                      c.loyaltyTier === "PLATINUM"
                        ? "URGENT"
                        : c.loyaltyTier === "GOLD"
                        ? "HIGH"
                        : "READY"
                    }
                    label={c.loyaltyTier}
                  />
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-lg border bg-card shadow-sm">
          <header className="border-b px-4 py-3">
            <h2 className="h3">Geographic distribution</h2>
            <p className="text-caption text-muted-foreground">
              Where customers live, across four lenses
            </p>
          </header>
          <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="sm:border-b">
              <GeoQuadrant
                title="Australian states"
                subtitle="AU only"
                variant="donut"
                isLoading={geoQuery.isLoading}
                emptyLabel="No AU data yet."
                items={geoQuery.data?.states.map((r) => ({
                  key: r.state,
                  label: r.state,
                  count: r.count,
                }))}
              />
            </div>
            <div className="sm:border-b">
              <GeoQuadrant
                title="Countries"
                subtitle="Worldwide"
                variant="pie"
                isLoading={geoQuery.isLoading}
                emptyLabel="No country data yet."
                items={geoQuery.data?.countries.map((r) => ({
                  key: r.country,
                  label: r.country,
                  count: r.count,
                }))}
              />
            </div>
            <div className="border-t sm:border-t-0">
              <GeoQuadrant
                title="Postcodes"
                subtitle="Top AU postcodes"
                variant="donut-thin"
                isLoading={geoQuery.isLoading}
                emptyLabel="No postcode data yet."
                items={geoQuery.data?.postcodes.map((r, i) => ({
                  key: `${r.postcode}-${r.state}-${i}`,
                  label: r.postcode,
                  meta: r.state,
                  count: r.count,
                }))}
              />
            </div>
            <div className="border-t sm:border-t-0">
              <GeoQuadrant
                title="Suburbs"
                subtitle="Top AU suburbs"
                variant="pie-split"
                isLoading={geoQuery.isLoading}
                emptyLabel="No suburb data yet."
                items={geoQuery.data?.suburbs.map((r, i) => ({
                  key: `${r.suburb}-${r.state}-${i}`,
                  label: r.suburb,
                  meta: r.state,
                  count: r.count,
                }))}
              />
            </div>
          </div>
        </section>

        <section className="rounded-lg border bg-card shadow-sm">
          <header className="border-b px-4 py-3">
            <h2 className="h3">Customer mix</h2>
            <p className="text-caption text-muted-foreground">
              Who the customer base is, across four lenses
            </p>
          </header>
          <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="sm:border-b">
              <GeoQuadrant
                title="Licence verification"
                subtitle="Verified vs pending"
                variant="donut"
                isLoading={mixQuery.isLoading}
                emptyLabel="No customers yet."
                items={mixQuery.data?.licenceVerification.map((r) => ({
                  key: r.label,
                  label: r.label,
                  count: r.count,
                }))}
              />
            </div>
            <div className="sm:border-b">
              <GeoQuadrant
                title="Licence class"
                subtitle="Fleet-fit"
                variant="pie"
                isLoading={mixQuery.isLoading}
                emptyLabel="No licence data yet."
                items={mixQuery.data?.licenceClass.map((r) => ({
                  key: r.label,
                  label: r.label,
                  count: r.count,
                }))}
              />
            </div>
            <div className="border-t sm:border-t-0">
              <GeoQuadrant
                title="Licence expiry"
                subtitle="Compliance window"
                variant="donut-thin"
                isLoading={mixQuery.isLoading}
                emptyLabel="No licence data yet."
                items={mixQuery.data?.licenceExpiry.map((r) => ({
                  key: r.label,
                  label: r.label,
                  count: r.count,
                }))}
              />
            </div>
            <div className="border-t sm:border-t-0">
              <GeoQuadrant
                title="Age bands"
                subtitle="From date of birth"
                variant="pie-split"
                isLoading={mixQuery.isLoading}
                emptyLabel="No DOB data yet."
                items={mixQuery.data?.ageBand.map((r) => ({
                  key: r.label,
                  label: r.label,
                  count: r.count,
                }))}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

type GeoItem = {
  key: string;
  label: string;
  meta?: string;
  count: number;
};

type GeoVariant = "donut" | "pie" | "donut-thin" | "pie-split";

const GEO_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--secondary))",
  "hsl(var(--staff-accent))",
  "hsl(var(--primary) / 0.55)",
  "hsl(var(--muted-foreground) / 0.45)",
];

function GeoQuadrant({
  title,
  subtitle,
  items,
  isLoading,
  emptyLabel,
  variant,
}: {
  title: string;
  subtitle: string;
  items: GeoItem[] | undefined;
  isLoading: boolean;
  emptyLabel: string;
  variant: GeoVariant;
}) {
  const rows = items ?? [];
  const total = rows.reduce((a, b) => a + b.count, 0);

  const ringProps = (() => {
    switch (variant) {
      case "donut":
        return { innerRadius: 21, outerRadius: 34, paddingAngle: 2 };
      case "donut-thin":
        return { innerRadius: 27, outerRadius: 34, paddingAngle: 1 };
      case "pie":
        return { innerRadius: 0, outerRadius: 34, paddingAngle: 0 };
      case "pie-split":
        return { innerRadius: 0, outerRadius: 34, paddingAngle: 3 };
    }
  })();

  const showCenter = variant === "donut" || variant === "donut-thin";

  return (
    <div className="flex h-full flex-col px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{subtitle}</span>
      </div>
      {isLoading ? (
        <div className="flex h-[88px] items-center justify-center">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-[88px] items-center justify-center text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-3">
          <div className="relative h-[80px] w-[80px] shrink-0">
            <PieChart width={80} height={80}>
              <Pie
                data={rows}
                dataKey="count"
                nameKey="label"
                stroke="none"
                isAnimationActive={false}
                {...ringProps}
              >
                {rows.map((_, i) => (
                  <Cell key={i} fill={GEO_COLORS[i % GEO_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                cursor={false}
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.375rem",
                  fontSize: "11px",
                  padding: "4px 8px",
                }}
                formatter={(value) => [Number(value).toLocaleString(), "customers"]}
              />
            </PieChart>
            {showCenter && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-sm font-semibold leading-none tabular-nums">
                  {total.toLocaleString()}
                </span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                  total
                </span>
              </div>
            )}
          </div>
          <ul className="min-w-0 flex-1 space-y-1 text-[11px]">
            {rows.slice(0, 5).map((item, i) => {
              const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
              return (
                <li key={item.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: GEO_COLORS[i % GEO_COLORS.length] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {item.label}
                    {item.meta && (
                      <span className="ml-1 text-muted-foreground">· {item.meta}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
