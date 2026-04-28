import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkNswRego } from "@/server/services/rego-check";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "rego-sync" as const;

/**
 * Weekly: for each active NSW-registered vehicle, run the Service NSW rego
 * check and update `regoExpiry` / surface a notification if the scraper
 * reports an unexpected status. Throttled to ~1 req/10s to stay under the
 * informal rate limit of the public rego-check page.
 */
export async function runRegoSync(): Promise<{ checked: number; updated: number; errors: number }> {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      isActive: true,
      regoState: "NSW",
      status: { notIn: ["SOLD", "END_OF_LIFE", "WRITTEN_OFF", "STOLEN"] },
    },
    select: { id: true, rego: true, regoExpiry: true },
  });

  let updated = 0;
  let errors = 0;

  for (const v of vehicles) {
    if (!v.rego) continue;
    const result = await checkNswRego(v.rego);
    if (result.status === "UNKNOWN") {
      errors++;
      continue;
    }
    if (
      result.expiryDate &&
      (!v.regoExpiry || Math.abs(v.regoExpiry.getTime() - result.expiryDate.getTime()) > 86_400_000)
    ) {
      await prisma.vehicle.update({
        where: { id: v.id },
        data: { regoExpiry: result.expiryDate },
      });
      updated++;
      logger.info(
        { vehicleId: v.id, plate: v.rego, newExpiry: result.expiryDate.toISOString() },
        "rego-sync: updated expiry",
      );
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }

  return { checked: vehicles.length, updated, errors };
}

export function startRegoSyncScheduler() {
  registerWorker(QUEUE, async () => runRegoSync());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "weekly",
    {},
    { repeat: { pattern: "0 4 * * 1", tz: "Australia/Sydney" }, jobId: "repeat-weekly" },
  );
}
