"use client";

import * as React from "react";
import { Globe2, Link2, MapPin, TrendingUp } from "lucide-react";
import { LegendDot, LoadingBlock, MiniStackedBar } from "@/components/ui/stat-shell";
import { trpc } from "@/lib/trpc/client";
import { useAnalyticsFilters } from "@/hooks/use-analytics-filters";
import { downloadCsv } from "@/lib/analytics/csv";
import { AnalyticsFilterBar } from "./analytics-filter-bar";
import { RankedRow, useDrilldown } from "./analytics-shared";

export function AcquisitionTab({ active }: { active: boolean }) {
  const { filters } = useAnalyticsFilters();
  const drilldown = useDrilldown();
  const query = trpc.liveAnalytics.acquisition.useQuery(
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
      "analytics-acquisition",
      [
        ...data.channel.map((r) => ({ group: "Channel", value: r.channel, count: r.count })),
        ...data.utmSource.map((r) => ({ group: "UTM source", value: r.value ?? "", count: r.count })),
        ...data.utmMedium.map((r) => ({ group: "UTM medium", value: r.value ?? "", count: r.count })),
        ...data.utmCampaign.map((r) => ({ group: "UTM campaign", value: r.value ?? "", count: r.count })),
        ...data.referrer.map((r) => ({ group: "Referrer", value: r.value ?? "", count: r.count })),
        ...data.landing.map((r) => ({ group: "Landing path", value: r.path ?? "", count: r.count })),
        ...data.country.map((r) => ({ group: "Country", value: r.country ?? "", count: r.count })),
        ...data.region.map((r) => ({
          group: "Region",
          value: `${r.country ?? ""}·${r.region ?? ""}`,
          count: r.count,
        })),
        ...data.city.map((r) => ({
          group: "City",
          value: `${r.country ?? ""}·${r.region ?? ""}·${r.city ?? ""}`,
          count: r.count,
        })),
      ],
      ["group", "value", "count"],
    );
  }, [data]);

  return (
    <div className="space-y-4">
      <AnalyticsFilterBar
        description="Channel attribution, UTM source / medium / campaign, referrer domains, landing-page conversion, and geo country→region→city."
        onExport={onExport}
      />

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="h3 mb-3 flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
          Channel mix
        </h3>
        {loading || !data ? (
          <LoadingBlock className="h-10 w-full" />
        ) : data.channel.length === 0 ? (
          <EmptyLine text="No channel data yet." />
        ) : (
          <ChannelMixBar channel={data.channel} total={data.totalSessions} />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="UTM source" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.utmSource.length === 0 ? (
            <EmptyLine text="No tagged traffic yet." />
          ) : (
            <div className="space-y-1">
              {data.utmSource.map((u) => (
                <RankedRow
                  key={u.value ?? "u"}
                  label={u.value ?? "(direct)"}
                  value={u.count}
                  total={data.totalSessions}
                  onClick={u.value ? () => drilldown({ source: u.value }) : undefined}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="UTM medium" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.utmMedium.length === 0 ? (
            <EmptyLine text="No medium data." />
          ) : (
            <div className="space-y-1">
              {data.utmMedium.map((u) => (
                <RankedRow
                  key={u.value ?? "u"}
                  label={u.value ?? "(none)"}
                  value={u.count}
                  total={data.totalSessions}
                  onClick={u.value ? () => drilldown({ medium: u.value }) : undefined}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="UTM campaign" icon={<TrendingUp className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.utmCampaign.length === 0 ? (
            <EmptyLine text="No campaigns." />
          ) : (
            <div className="space-y-1">
              {data.utmCampaign.map((u) => (
                <RankedRow
                  key={u.value ?? "u"}
                  label={u.value ?? "(none)"}
                  value={u.count}
                  total={data.totalSessions}
                  onClick={u.value ? () => drilldown({ campaign: u.value }) : undefined}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Referrer domains" icon={<Link2 className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.referrer.length === 0 ? (
            <EmptyLine text="Mostly direct traffic." />
          ) : (
            <div className="space-y-1">
              {data.referrer.map((r) => (
                <RankedRow
                  key={r.value ?? "u"}
                  label={<span className="font-mono text-[11px]">{r.value ?? "(direct)"}</span>}
                  value={r.count}
                  total={data.totalSessions}
                  onClick={r.value ? () => drilldown({ referrer: r.value }) : undefined}
                />
              ))}
            </div>
          )}
        </Card>

        <Card title="Top countries" icon={<Globe2 className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.country.length === 0 ? (
            <EmptyLine text="No geo data yet." />
          ) : (
            <div className="space-y-1">
              {data.country.map((c) => (
                <RankedRow
                  key={c.country ?? "u"}
                  label={c.country ?? "Unknown"}
                  value={c.count}
                  total={data.totalSessions}
                  onClick={c.country ? () => drilldown({ country: c.country }) : undefined}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Landing-page conversion"
          icon={<MapPin className="h-4 w-4" aria-hidden />}
          description="Share of sessions that converted after landing here."
        >
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.landingConversion.length === 0 ? (
            <EmptyLine text="No landing data yet." />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-2 text-left font-normal">Landing</th>
                  <th className="pb-2 text-right font-normal">Sessions</th>
                  <th className="pb-2 text-right font-normal">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {data.landingConversion.map((l) => (
                  <tr key={l.path ?? "u"}>
                    <td className="py-1">
                      <button
                        type="button"
                        onClick={l.path ? () => drilldown({ landing: l.path }) : undefined}
                        disabled={!l.path}
                        className="truncate font-mono text-[11px] hover:text-primary"
                      >
                        {l.path ?? "—"}
                      </button>
                    </td>
                    <td className="py-1 text-right tabular-nums">{l.total.toLocaleString("en-AU")}</td>
                    <td className="py-1 text-right tabular-nums">
                      {(l.conversionRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Regions & cities" icon={<Globe2 className="h-4 w-4" aria-hidden />}>
          {loading || !data ? (
            <LoadingBlock className="h-40 w-full" />
          ) : data.region.length === 0 && data.city.length === 0 ? (
            <EmptyLine text="No region data yet." />
          ) : (
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Top regions
                </p>
                <ul className="space-y-0.5">
                  {data.region.map((r, i) => (
                    <li key={`${r.country}-${r.region}-${i}`} className="flex justify-between gap-2">
                      <span className="truncate">
                        {r.region ?? "—"}{" "}
                        <span className="text-muted-foreground">· {r.country ?? "—"}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Top cities
                </p>
                <ul className="space-y-0.5">
                  {data.city.map((c, i) => (
                    <li key={`${c.country}-${c.region}-${c.city}-${i}`} className="flex justify-between gap-2">
                      <span className="truncate">
                        {c.city ?? "—"}{" "}
                        <span className="text-muted-foreground">· {c.region ?? "—"}</span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">{c.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  description,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="h3 mb-1 flex items-center gap-2 text-sm">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        {title}
      </h3>
      {description ? <p className="mb-3 text-[11px] text-muted-foreground">{description}</p> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

const CHANNEL_COLOR: Record<string, string> = {
  DIRECT: "--muted-foreground",
  ORGANIC: "--primary",
  PAID: "--secondary",
  SOCIAL: "--accent",
  EMAIL: "--primary",
  REFERRAL: "--accent",
  OTHER: "--muted-foreground",
};

function ChannelMixBar({
  channel,
  total,
}: {
  channel: Array<{ channel: string; count: number }>;
  total: number;
}) {
  const segments = channel.map((c) => ({
    value: c.count,
    colorVar: CHANNEL_COLOR[c.channel] ?? "--primary",
    label: c.channel,
  }));
  return (
    <div className="space-y-3">
      <MiniStackedBar segments={segments} height="h-3" />
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {channel.map((c) => (
          <LegendDot key={c.channel} colorVar={CHANNEL_COLOR[c.channel] ?? "--primary"}>
            {c.channel} · {c.count.toLocaleString("en-AU")}
            {total > 0 ? ` (${((c.count / total) * 100).toFixed(0)}%)` : ""}
          </LegendDot>
        ))}
      </div>
    </div>
  );
}
