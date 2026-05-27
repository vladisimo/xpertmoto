/**
 * Runs all six generators in parallel, then hits the AI narrator for each
 * payload (also in parallel). Failures in a single insight do not fail
 * the whole batch — the card simply falls back to its deterministic
 * narrative. The result is a fully shaped InsightsOverview that the
 * tRPC overview procedure can serve straight from cache.
 */

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { generateRepeatCohort } from "./generators/repeat-cohort";
import { generateTopCustomersAtRisk } from "./generators/top-customers-at-risk";
import { generateRevenuePerVehicleDay } from "./generators/revenue-per-vehicle-day";
import { generateMaintenanceVsRevenue } from "./generators/maintenance-vs-revenue";
import { generateRevenueTrend } from "./generators/revenue-trend";
import { generateAcquisitionConversion } from "./generators/acquisition-conversion";
import { narrateInsight } from "./narrate";
import {
  assessInsightsReadiness,
  InsightsDataInsufficientError,
} from "./readiness";
import {
  INSIGHT_IDS,
  INSIGHT_META,
  type InsightCard,
  type InsightId,
  type InsightPayload,
  type InsightsGeneratorContext,
  type InsightsOverview,
} from "./types";

const GENERATORS: Record<
  InsightId,
  (
    prisma: PrismaClient,
    ctx: InsightsGeneratorContext,
  ) => Promise<InsightPayload>
> = {
  "repeat-cohort": generateRepeatCohort,
  "top-customers-at-risk": generateTopCustomersAtRisk,
  "revenue-per-vehicle-day": generateRevenuePerVehicleDay,
  "maintenance-vs-revenue": generateMaintenanceVsRevenue,
  "revenue-trend": generateRevenueTrend,
  "acquisition-conversion": generateAcquisitionConversion,
};

const PRIORITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export async function generateInsightsOverview(
  prisma: PrismaClient,
  depotId?: string,
  scopeLabel = "All depots",
): Promise<InsightsOverview> {
  const now = new Date();
  const readiness = await assessInsightsReadiness(prisma, depotId);
  if (!readiness.sufficient) {
    return {
      cards: [],
      generatedAt: now.toISOString(),
      scopeLabel,
      stale: false,
      readiness,
    };
  }

  const ctx: InsightsGeneratorContext = { depotId, now };

  const payloads = await Promise.all(
    INSIGHT_IDS.map(async (id) => {
      try {
        return { id, payload: await GENERATORS[id](prisma, ctx) };
      } catch (err) {
        logger.error({ err, insightId: id }, "insight generator failed");
        return null;
      }
    }),
  );

  const valid = payloads.filter(
    (p): p is { id: InsightId; payload: InsightPayload } => p !== null,
  );

  const cards = await Promise.all(
    valid.map(async ({ id, payload }) => {
      const meta = INSIGHT_META[id];
      const narrative = await narrateInsight(payload, { depotId });
      const card: InsightCard = {
        id,
        pillar: meta.pillar,
        title: meta.title,
        payload,
        narrative,
        detailHref: `/ai-insights/${id}`,
        generatedAt: now.toISOString(),
      };
      return card;
    }),
  );

  cards.sort((a, b) => {
    const priorityDiff =
      (PRIORITY_RANK[a.narrative.priority] ?? 3) -
      (PRIORITY_RANK[b.narrative.priority] ?? 3);
    if (priorityDiff !== 0) return priorityDiff;
    return b.narrative.confidence - a.narrative.confidence;
  });

  return {
    cards,
    generatedAt: now.toISOString(),
    scopeLabel,
    stale: false,
    readiness,
  };
}

export async function generatePayload(
  prisma: PrismaClient,
  id: InsightId,
  depotId?: string,
): Promise<InsightPayload> {
  const readiness = await assessInsightsReadiness(prisma, depotId);
  if (!readiness.sufficient) {
    throw new InsightsDataInsufficientError(readiness);
  }
  return GENERATORS[id](prisma, { depotId, now: new Date() });
}
