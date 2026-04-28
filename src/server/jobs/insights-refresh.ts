/**
 * Daily regeneration of AI Insights. Runs at 03:00 AEST by default
 * (configurable via INSIGHTS_REFRESH_CRON). For every active depot plus
 * the org-wide scope, regenerates all insight payloads and their
 * narratives and writes the result to Redis. The overview tRPC
 * procedure then serves from cache for the rest of the day.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { generateInsightsOverview } from "@/server/services/insights/orchestrator";
import {
  invalidateOverviewCache,
  writeOverviewCache,
} from "@/server/services/insights/cache";
import { assessInsightsReadiness } from "@/server/services/insights/readiness";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "insights-refresh" as const;
const CRON = process.env.INSIGHTS_REFRESH_CRON ?? "0 3 * * *";

export async function runInsightsRefresh(): Promise<{
  scopes: number;
  failures: number;
  durationMs: number;
}> {
  const start = Date.now();
  const depots = await prisma.depot.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const scopes: Array<{ depotId?: string; label: string }> = [
    { label: "All depots" },
    ...depots.map((d) => ({ depotId: d.id, label: d.name })),
  ];

  let failures = 0;
  for (const scope of scopes) {
    try {
      const readiness = await assessInsightsReadiness(prisma, scope.depotId);
      if (!readiness.sufficient) {
        await invalidateOverviewCache(scope.depotId);
        logger.info(
          { scope: scope.label, missing: readiness.missing },
          "insights refresh skipped — data readiness gate",
        );
        continue;
      }
      const overview = await generateInsightsOverview(
        prisma,
        scope.depotId,
        scope.label,
      );
      await writeOverviewCache(overview, scope.depotId);
      logger.info(
        { scope: scope.label, cards: overview.cards.length },
        "insights refreshed",
      );
    } catch (err) {
      failures++;
      logger.error({ err, scope: scope.label }, "insights refresh failed");
    }
  }

  return { scopes: scopes.length, failures, durationMs: Date.now() - start };
}

export function startInsightsRefreshScheduler() {
  registerWorker(QUEUE, async () => runInsightsRefresh());
  const queue = getQueue(QUEUE);
  if (queue) {
    queue.add(
      "daily",
      {},
      {
        repeat: { pattern: CRON, tz: "Australia/Brisbane" },
        jobId: "repeat-daily",
      },
    );
  }
}
