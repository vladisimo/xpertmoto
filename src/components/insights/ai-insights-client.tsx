"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import {
  PILLAR_META,
  type InsightCard,
  type InsightPillar,
} from "@/server/services/insights/types";
import { InsightHero } from "./insight-hero";
import { InsightPillarSection } from "./insight-pillar-section";
import { InsightsNotReady } from "./insights-not-ready";

interface Props {
  basePath: string;
}

const PILLAR_ORDER: InsightPillar[] = [
  "customer",
  "fleet",
  "revenue",
  "acquisition",
];

export function AiInsightsClient({ basePath }: Props) {
  const overviewQuery = trpc.insights.overview.useQuery(
    {},
    { staleTime: 30_000, refetchOnWindowFocus: false },
  );
  const utils = trpc.useUtils();
  const refresh = trpc.insights.refresh.useMutation({
    onSuccess: (data) => {
      utils.insights.overview.setData({}, data);
    },
  });

  const overview = overviewQuery.data;
  const loading = overviewQuery.isLoading;

  const cardsByPillar = React.useMemo(() => {
    const map = new Map<InsightPillar, InsightCard[]>();
    if (!overview) return map;
    for (const card of overview.cards) {
      const arr = map.get(card.pillar) ?? [];
      arr.push(card);
      map.set(card.pillar, arr);
    }
    return map;
  }, [overview]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <InsightHero
        overview={overview}
        onRefresh={() => refresh.mutate({})}
        refreshing={refresh.isPending}
        error={refresh.error?.message ?? overviewQuery.error?.message ?? null}
      />

      <div className="-mx-6 flex-1 space-y-8 overflow-y-auto px-6 pb-6 lg:-mx-8 lg:px-8 lg:pb-8">
        {loading && <InsightsLoading />}

        {!loading && overview && !overview.readiness.sufficient && (
          <InsightsNotReady readiness={overview.readiness} />
        )}

        {!loading &&
          overview?.readiness.sufficient &&
          PILLAR_ORDER.map((pillar) => {
            const cards = cardsByPillar.get(pillar) ?? [];
            if (cards.length === 0) return null;
            return (
              <InsightPillarSection
                key={pillar}
                pillar={pillar}
                cards={cards}
                basePath={basePath}
              />
            );
          })}

        {/* Acknowledge PILLAR_META so it's referenced even when no cards fall in that pillar. */}
        <span className="sr-only">
          {PILLAR_ORDER.map((p) => PILLAR_META[p].label).join(" ")}
        </span>
      </div>
    </div>
  );
}

function InsightsLoading() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-64 animate-pulse rounded-lg border bg-card"
          aria-hidden
        />
      ))}
    </div>
  );
}
