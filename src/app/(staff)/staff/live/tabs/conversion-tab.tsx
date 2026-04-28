"use client";

import * as React from "react";
import { DollarSign, MapPin, Percent, Tag, TrendingDown, TrendingUp, Truck } from "lucide-react";
import { LegendDot, LoadingBlock } from "@/components/ui/stat-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { trpc } from "@/lib/trpc/client";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { downloadCsv } from "@/lib/analytics/csv";
import { AnalyticsFilterBar } from "./analytics-filter-bar";
import { RankedRow, useDrilldown } from "./analytics-shared";
import { CustomFunnelCard } from "./custom-funnel-card";

const WIZARD_STEP_LABELS = ["Search", "Vehicle", "Extras", "Details", "Review", "Payment"];

export function ConversionTab({ active }: { active: boolean }) {
  const { filters } = useAnalyticsFilters();
  const drilldown = useDrilldown();
  const query = trpc.liveAnalytics.conversion.useQuery(
    {
      range: filters.range,
      segment: filters.segment,
      country: filters.country ?? undefined,
      landingPath: filters.landing ?? undefined,
      utmSource: filters.source ?? undefined,
      utmMedium: filters.medium ?? undefined,
      utmCampaign: filters.campaign ?? undefined,
      referrerDomain: filters.referrer ?? undefined,
      wizardStepEq: filters.step ?? undefined,
      hour: filters.hour ?? undefined,
      dow: filters.dow ?? undefined,
      pickupDepotId: filters.depot ?? undefined,
      categoryId: filters.category ?? undefined,
      vehicleId: filters.vehicle ?? undefined,
      discountCode: filters.code ?? undefined,
    },
    { enabled: active, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  const data = query.data;
  const loading = query.isLoading;

  const onExport = React.useCallback(() => {
    if (!data) return;
    downloadCsv(
      "analytics-conversion",
      [
        ...data.funnel.map((f) => ({
          group: "Funnel",
          key: `Step ${f.step}`,
          count: f.reached,
          droppedAtStep: f.droppedAtStep,
          dropOffRate: f.dropOffRate ?? "",
        })),
        ...data.outcome.map((o) => ({
          group: "Outcome",
          key: o.outcome ?? "",
          count: o.count,
          droppedAtStep: "",
          dropOffRate: "",
        })),
        ...data.abandonedByStep.map((a) => ({
          group: "Abandoned at step",
          key: `Step ${a.step}`,
          count: a.count,
          droppedAtStep: "",
          dropOffRate: "",
        })),
        ...data.abandonedCart.vehicles.map((v) => ({
          group: "Abandoned vehicle",
          key: v.label,
          count: v.count,
          droppedAtStep: "",
          dropOffRate: "",
        })),
        ...data.abandonedCart.categories.map((c) => ({
          group: "Abandoned category",
          key: c.label,
          count: c.count,
          droppedAtStep: "",
          dropOffRate: "",
        })),
        ...data.abandonedCart.depots.map((d) => ({
          group: "Abandoned depot",
          key: d.label,
          count: d.count,
          droppedAtStep: "",
          dropOffRate: "",
        })),
        ...data.abandonedCart.discountCodes.map((c) => ({
          group: "Abandoned discount code",
          key: c.code ?? "",
          count: c.count,
          droppedAtStep: "",
          dropOffRate: "",
        })),
      ],
      ["group", "key", "count", "droppedAtStep", "dropOffRate"],
    );
  }, [data]);

  return (
    <div className="space-y-4">
      <AnalyticsFilterBar
        description="Wizard funnel with step-over-step drop-off, outcome split, and a map of which step visitors are bailing at."
        onExport={onExport}
      />

      <CustomFunnelCard />

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="h3 flex items-center gap-2 text-sm">
            <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
            Wizard funnel &amp; drop-off
          </h3>
          <p className="text-[10px] text-muted-foreground">Click a step to see sessions that reached it</p>
        </div>
        {loading || !data ? (
          <LoadingBlock className="h-56 w-full" />
        ) : (
          <div className="space-y-3">
            {data.funnel.map((f) => {
              const share =
                data.totalSessions > 0
                  ? Math.min(100, Math.round((f.reached / data.totalSessions) * 100))
                  : 0;
              return (
                <button
                  key={f.step}
                  type="button"
                  onClick={() => drilldown({ step: f.step })}
                  className="block w-full rounded p-2 text-left transition hover:bg-muted/60"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium text-foreground">
                      Step {f.step} · {WIZARD_STEP_LABELS[f.step - 1]}
                      <span className="ml-2 text-muted-foreground">{share}%</span>
                    </span>
                    <span className="flex items-baseline gap-2 text-xs">
                      <span className="tabular-nums text-muted-foreground">
                        {f.reached.toLocaleString("en-AU")} reached
                      </span>
                      {f.dropOffRate != null && (
                        f.dropOffRate > 0.3 ? (
                          <StatusBadge
                            status="AT_RISK"
                            label={`-${(f.dropOffRate * 100).toFixed(0)}% vs prev`}
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            -{(f.dropOffRate * 100).toFixed(0)}% vs prev
                          </span>
                        )
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${share}%` }}
                      aria-hidden
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
            Outcome split
          </h3>
          {loading || !data ? (
            <LoadingBlock className="h-32 w-full" />
          ) : data.outcome.length === 0 ? (
            <p className="text-xs text-muted-foreground">No outcomes recorded.</p>
          ) : (
            (() => {
              const total = data.outcome.reduce((a, o) => a + o.count, 0);
              const color = (o: string | null) => {
                if (o === "CONVERTED") return "--primary";
                if (o === "ABANDONED_WIZARD") return "--accent";
                if (o === "BOUNCED") return "--secondary";
                return "--muted-foreground";
              };
              return (
                <div className="space-y-3">
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                    {data.outcome.map((o) => (
                      <div
                        key={o.outcome ?? "u"}
                        className="h-full"
                        style={{
                          width: `${(o.count / total) * 100}%`,
                          backgroundColor: `hsl(var(${color(o.outcome)}))`,
                        }}
                        title={`${o.outcome ?? "—"}: ${o.count.toLocaleString("en-AU")}`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {data.outcome.map((o) => (
                      <LegendDot key={o.outcome ?? "u"} colorVar={color(o.outcome)}>
                        {o.outcome ?? "—"} · {o.count.toLocaleString("en-AU")} (
                        {((o.count / total) * 100).toFixed(0)}%)
                      </LegendDot>
                    ))}
                  </div>
                </div>
              );
            })()
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
            <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
            Abandonment hotspots
          </h3>
          {loading || !data ? (
            <LoadingBlock className="h-32 w-full" />
          ) : data.abandonedByStep.length === 0 ? (
            <p className="text-xs text-muted-foreground">No abandoned wizards in this range.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-2 text-left font-normal">Step</th>
                  <th className="pb-2 text-right font-normal">Abandoned</th>
                </tr>
              </thead>
              <tbody>
                {data.abandonedByStep.map((a) => (
                  <tr key={a.step} className="border-t">
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => drilldown({ step: a.step })}
                        className="text-left hover:text-primary"
                      >
                        Step {a.step} · {WIZARD_STEP_LABELS[a.step - 1]}
                      </button>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {a.count.toLocaleString("en-AU")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {data?.abandonedCart && (
        <>
          {data.abandonedCart.revenueAtRiskSampleSize > 0 && (
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="h3 flex items-center gap-2 text-sm">
                  <DollarSign className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Revenue at risk — abandoned carts
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  Across {data.abandonedCart.revenueAtRiskSampleSize.toLocaleString("en-AU")} quoted abandons
                </span>
              </div>
              <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-primary">
                ${(data.abandonedCart.revenueAtRiskCents / 100).toLocaleString("en-AU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sum of last-quoted totals for sessions that abandoned the wizard in range.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AbandonedCard
              title="Top abandoned vehicles"
              icon={<Truck className="h-4 w-4" aria-hidden />}
              rows={data.abandonedCart.vehicles}
              onRowClick={(id) => id && drilldown({ vehicle: id })}
              emptyText="No vehicle selections in abandoned carts."
            />
            <AbandonedCard
              title="Top abandoned categories"
              icon={<Tag className="h-4 w-4" aria-hidden />}
              rows={data.abandonedCart.categories}
              onRowClick={(id) => id && drilldown({ category: id })}
              emptyText="No category selections in abandoned carts."
            />
            <AbandonedCard
              title="Top abandoned depots"
              icon={<MapPin className="h-4 w-4" aria-hidden />}
              rows={data.abandonedCart.depots}
              onRowClick={(id) => id && drilldown({ depot: id })}
              emptyText="No depot selections in abandoned carts."
            />
            <AbandonedCard
              title="Abandoned discount codes"
              icon={<Percent className="h-4 w-4" aria-hidden />}
              rows={data.abandonedCart.discountCodes.map((c) => ({
                id: c.code,
                label: c.code ?? "(none)",
                count: c.count,
              }))}
              onRowClick={(id) => id && drilldown({ code: id })}
              emptyText="No discount-code attempts in abandoned carts."
            />
          </div>
        </>
      )}
    </div>
  );
}

function AbandonedCard({
  title,
  icon,
  rows,
  onRowClick,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ id: string | null; label: string; count: number }>;
  onRowClick: (id: string | null) => void;
  emptyText: string;
}) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <RankedRow
              key={r.id ?? `u${i}`}
              label={r.label}
              value={r.count}
              total={total}
              onClick={r.id ? () => onRowClick(r.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
