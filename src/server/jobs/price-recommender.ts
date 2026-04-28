import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { computeRecommendation } from "@/server/services/yield-pricing";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "price-recommender" as const;

/**
 * Lever 1: nightly pricing computation.
 *
 * For every active (depot × category) pair, compute a yield
 * recommendation for the next 45 days and persist to
 * PriceRecommendation. Admin overrides are preserved. Pricing quotes
 * look these up via lookupOrComputeMultiplier so the rate shown in
 * /admin/pricing/yield matches the rate applied at booking time.
 */

const HORIZON_DAYS = 45;

export type PriceRecommenderResult = {
  pairs: number;
  recommendations: number;
};

export async function runPriceRecommender(
  now: Date = new Date(),
): Promise<PriceRecommenderResult> {
  const counters: PriceRecommenderResult = { pairs: 0, recommendations: 0 };

  const [depots, categories] = await Promise.all([
    prisma.depot.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.vehicleCategory.findMany({
      where: { isActive: true },
      select: { id: true },
    }),
  ]);

  for (const depot of depots) {
    for (const cat of categories) {
      counters.pairs += 1;
      for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
        const target = new Date(now);
        target.setHours(0, 0, 0, 0);
        target.setDate(target.getDate() + offset);

        try {
          const rec = await computeRecommendation(prisma, {
            depotId: depot.id,
            categoryId: cat.id,
            targetDate: target,
            now,
          });
          await prisma.priceRecommendation.upsert({
            where: {
              date_depotId_categoryId: {
                date: target,
                depotId: depot.id,
                categoryId: cat.id,
              },
            },
            update: {
              baseMultiplier: rec.multiplier,
              reasonCodes: rec.reasonCodes,
              forwardBookingPct: rec.forwardBookingPct * 100,
              demandScore: rec.demandScore,
              computedAt: now,
              isActive: true,
            },
            create: {
              date: target,
              depotId: depot.id,
              categoryId: cat.id,
              baseMultiplier: rec.multiplier,
              reasonCodes: rec.reasonCodes,
              forwardBookingPct: rec.forwardBookingPct * 100,
              demandScore: rec.demandScore,
              computedAt: now,
              isActive: true,
            },
          });
          counters.recommendations += 1;
        } catch (err) {
          logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              depotId: depot.id,
              categoryId: cat.id,
              target,
            },
            "price-recommender: recommendation failed",
          );
        }
      }
    }
  }

  logger.info(counters, "price-recommender finished");
  return counters;
}

export function startPriceRecommenderScheduler() {
  registerWorker(QUEUE, async () => runPriceRecommender());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Nightly at 04:00 Brisbane (after pending-payment-ttl and
  // revenue-reconcile windows).
  q.add(
    "nightly",
    {},
    { repeat: { pattern: "0 4 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly-yield" },
  );
}
