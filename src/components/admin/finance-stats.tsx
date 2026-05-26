"use client";

import * as React from "react";
import { DollarSign, Landmark, ArrowLeftRight, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface FinanceStatsData {
  cash: {
    revenueInc: number;
    revenueEx: number;
    gstCollected: number;
    gstOnRefunds: number;
    netGst: number;
    inflows: number;
    outflows: number;
    net: number;
  };
  booking: { grossBooked: number; bookingCount: number; avgBookingValue: number };
  outstanding: {
    balance: number;
    count: number;
    aging: { under30: number; under60: number; under90: number; over90: number };
  };
}

export function FinanceStats({ data, loading }: { data?: FinanceStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <NetRevenueCard data={data} loading={loading} />
      <GstToLodgeCard data={data} loading={loading} />
      <CashFlowCard data={data} loading={loading} />
      <OutstandingCard data={data?.outstanding} loading={loading} />
    </div>
  );
}

function NetRevenueCard({ data, loading }: { data?: FinanceStatsData; loading?: boolean }) {
  return (
    <StatShell title="Net revenue" icon={<DollarSign className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-32" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {formatCurrency(data.cash.revenueInc)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            ex{" "}
            <span className="tabular-nums text-foreground">{formatCurrency(data.cash.revenueEx)}</span> · GST{" "}
            <span className="tabular-nums text-foreground">{formatCurrency(data.cash.gstCollected)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            gross booked{" "}
            <span className="tabular-nums">{formatCurrency(data.booking.grossBooked)}</span> ·{" "}
            {data.booking.bookingCount} bookings
          </div>
        </>
      )}
    </StatShell>
  );
}

function GstToLodgeCard({ data, loading }: { data?: FinanceStatsData; loading?: boolean }) {
  return (
    <StatShell title="GST to lodge" icon={<Landmark className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {formatCurrency(data.cash.netGst)}
          </div>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.cash.gstCollected, colorVar: "--admin-accent" },
              { value: data.cash.gstOnRefunds, colorVar: "--secondary" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">
              <span className="tabular-nums text-foreground">{formatCurrency(data.cash.gstCollected)}</span> collected
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{formatCurrency(data.cash.gstOnRefunds)}</span> credited
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function CashFlowCard({ data, loading }: { data?: FinanceStatsData; loading?: boolean }) {
  return (
    <StatShell title="Cash flow" icon={<ArrowLeftRight className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {formatCurrency(data.cash.net)}
          </div>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.cash.inflows, colorVar: "--admin-accent" },
              { value: data.cash.outflows, colorVar: "--destructive" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">
              <span className="tabular-nums text-foreground">{formatCurrency(data.cash.inflows)}</span> in
            </LegendDot>
            <LegendDot colorVar="--destructive">
              <span className="tabular-nums text-foreground">{formatCurrency(data.cash.outflows)}</span> out
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function OutstandingCard({
  data,
  loading,
}: {
  data?: FinanceStatsData["outstanding"];
  loading?: boolean;
}) {
  const aging = data?.aging;
  const total = aging ? aging.under30 + aging.under60 + aging.under90 + aging.over90 : 0;
  return (
    <StatShell title="Outstanding" icon={<AlertCircle className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {formatCurrency(data.balance)}
            <span className="ml-1 align-middle text-xs font-normal text-muted-foreground">
              ({data.count})
            </span>
          </div>
          {total === 0 || !aging ? (
            <div className="mt-2 text-xs text-muted-foreground">Nothing aged</div>
          ) : (
            <div className="mt-2 space-y-1.5">
              <PipelineRow label="0–30d" value={aging.under30} total={total} colorVar="--admin-accent" formatValue={formatCurrency} />
              <PipelineRow label="31–60d" value={aging.under60} total={total} colorVar="--secondary" formatValue={formatCurrency} />
              <PipelineRow label="61–90d" value={aging.under90} total={total} colorVar="--accent" formatValue={formatCurrency} />
              <PipelineRow label=">90d" value={aging.over90} total={total} colorVar="--destructive" formatValue={formatCurrency} />
            </div>
          )}
        </>
      )}
    </StatShell>
  );
}
