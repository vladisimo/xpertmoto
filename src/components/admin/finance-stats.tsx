"use client";

import * as React from "react";
import { Cell, Pie, PieChart } from "recharts";
import { DollarSign, Layers, PieChart as PieIcon, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { LegendDot, LoadingBlock, MiniStackedBar, PipelineRow, StatShell } from "@/components/ui/stat-shell";

export interface FinanceStatsData {
  totalRevenue: number;
  totalGst: number;
  bookingCount: number;
  avgBookingValue: number;
  byPaymentType: Record<string, number>;
  aging: { under30: number; under60: number; under90: number; over90: number };
}

const TYPE_COLORS: Record<string, string> = {
  BOOKING_PAYMENT: "--admin-accent",
  ADDON_CHARGE: "--accent",
  EXTENSION: "--staff-accent",
  DAMAGE_CHARGE: "--destructive",
  LATE_FEE: "--secondary",
  INFRINGEMENT_RECOVERY: "--muted-foreground",
  MANUAL_CHARGE: "--primary",
};

export function FinanceStats({ data, loading }: { data?: FinanceStatsData; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <RevenueCard data={data} loading={loading} />
      <GstSplitCard data={data} loading={loading} />
      <PaymentTypeCard data={data?.byPaymentType} loading={loading} />
      <AgingCard data={data?.aging} loading={loading} />
    </div>
  );
}

function RevenueCard({ data, loading }: { data?: FinanceStatsData; loading?: boolean }) {
  return (
    <StatShell title="Total revenue" icon={<DollarSign className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-10 w-32" />
      ) : (
        <>
          <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {formatCurrency(data.totalRevenue)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.bookingCount} bookings · avg {formatCurrency(data.avgBookingValue)}
          </div>
        </>
      )}
    </StatShell>
  );
}

function GstSplitCard({ data, loading }: { data?: FinanceStatsData; loading?: boolean }) {
  return (
    <StatShell title="GST vs ex-GST" icon={<Layers className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-12 w-full" />
      ) : (
        <>
          <MiniStackedBar
            height="h-2"
            segments={[
              { value: data.totalRevenue - data.totalGst, colorVar: "--admin-accent" },
              { value: data.totalGst, colorVar: "--secondary" },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <LegendDot colorVar="--admin-accent">
              <span className="tabular-nums text-foreground">{formatCurrency(data.totalRevenue - data.totalGst)}</span> ex-GST
            </LegendDot>
            <LegendDot colorVar="--secondary">
              <span className="tabular-nums text-foreground">{formatCurrency(data.totalGst)}</span> GST
            </LegendDot>
          </div>
        </>
      )}
    </StatShell>
  );
}

function PaymentTypeCard({
  data,
  loading,
}: {
  data?: Record<string, number>;
  loading?: boolean;
}) {
  const entries = Object.entries(data ?? {}).filter(([, v]) => v > 0);
  const slices = entries.slice(0, 6).map(([name, value]) => ({
    name,
    value,
    color: `hsl(var(${TYPE_COLORS[name] ?? "--muted-foreground"}))`,
  }));
  const sum = slices.reduce((a, b) => a + b.value, 0);
  return (
    <StatShell title="Payment mix" icon={<PieIcon className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : sum === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">No payments</div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            <PieChart width={64} height={64}>
              <Pie data={slices} dataKey="value" innerRadius={20} outerRadius={32} paddingAngle={2} stroke="none" isAnimationActive={false}>
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
          </div>
          <div className="min-w-0 space-y-1 text-[10px]">
            {slices.slice(0, 4).map((s) => (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="tabular-nums text-foreground">{formatCurrency(s.value)}</span>
                <span className="truncate text-muted-foreground">{s.name.toLowerCase().replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </StatShell>
  );
}

function AgingCard({ data, loading }: { data?: FinanceStatsData["aging"]; loading?: boolean }) {
  const total = data ? data.under30 + data.under60 + data.under90 + data.over90 : 0;
  return (
    <StatShell title="Outstanding aging" icon={<AlertCircle className="h-4 w-4" aria-hidden />}>
      {loading || !data ? (
        <LoadingBlock className="h-16 w-full" />
      ) : total === 0 ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">Nothing outstanding</div>
      ) : (
        <div className="space-y-2">
          <PipelineRow
            label="0–30 days"
            value={data.under30}
            total={total}
            colorVar="--admin-accent"
            formatValue={formatCurrency}
          />
          <PipelineRow
            label="31–60 days"
            value={data.under60}
            total={total}
            colorVar="--secondary"
            formatValue={formatCurrency}
          />
          <PipelineRow
            label="61–90 days"
            value={data.under90}
            total={total}
            colorVar="--accent"
            formatValue={formatCurrency}
          />
          <PipelineRow
            label=">90 days"
            value={data.over90}
            total={total}
            colorVar="--destructive"
            formatValue={formatCurrency}
          />
        </div>
      )}
    </StatShell>
  );
}
