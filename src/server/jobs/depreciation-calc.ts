import { prisma } from "@/lib/prisma";
import { calcDepreciation } from "@/server/services/depreciation";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "depreciation-calc" as const;

/**
 * Monthly, at 01:00 on the 1st. Recalculate current book value for every
 * vehicle that has a purchase price + method configured. Vehicles without
 * a depreciation configuration are skipped.
 */
export async function runDepreciation(): Promise<number> {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      purchasePrice: { not: null },
      purchaseDate: { not: null },
      depreciationMethod: { not: null },
      depreciationRate: { not: null },
    },
    select: {
      id: true,
      purchasePrice: true,
      purchaseDate: true,
      depreciationMethod: true,
      depreciationRate: true,
    },
  });

  let updated = 0;
  for (const v of vehicles) {
    const method = v.depreciationMethod === "DIMINISHING_VALUE"
      ? "DIMINISHING_VALUE"
      : "STRAIGHT_LINE";
    const result = calcDepreciation({
      purchasePrice: Number(v.purchasePrice),
      purchaseDate: v.purchaseDate!,
      method,
      rate: Number(v.depreciationRate),
    });
    await prisma.vehicle.update({
      where: { id: v.id },
      data: { currentBookValue: result.bookValue },
    });
    updated++;
  }
  return updated;
}

export function startDepreciationScheduler() {
  registerWorker(QUEUE, async () => runDepreciation());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "monthly",
    {},
    { repeat: { pattern: "0 1 1 * *", tz: "Australia/Brisbane" }, jobId: "repeat-monthly" },
  );
}
