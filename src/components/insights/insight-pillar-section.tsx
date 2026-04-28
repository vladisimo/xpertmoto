"use client";

import * as React from "react";
import { PageSection } from "@/components/layout/page-section";
import {
  PILLAR_META,
  type InsightCard as InsightCardType,
  type InsightPillar,
} from "@/server/services/insights/types";
import { InsightCard } from "./insight-card";
import { renderInsightPreview } from "./insight-preview";

interface Props {
  pillar: InsightPillar;
  cards: InsightCardType[];
  basePath: string;
}

export function InsightPillarSection({ pillar, cards, basePath }: Props) {
  if (cards.length === 0) return null;
  const meta = PILLAR_META[pillar];
  return (
    <PageSection
      title={meta.label}
      description={meta.description}
      flush
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <InsightCard key={card.id} card={card} basePath={basePath}>
            {renderInsightPreview(card)}
          </InsightCard>
        ))}
      </div>
    </PageSection>
  );
}
