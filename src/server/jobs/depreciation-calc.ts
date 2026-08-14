import { prisma } from "@/lib/prisma";
import { calcDepreciation } from "@/server/services/depreciation";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "depreciation-calc" as const;

/**
 * Vehicle statuses that mark a disposition (sold, retired, stolen, written
 * off). Book value freezes at the moment of disposition — the last computed
 * `currentBookValue` is the figure insurance claims and loss accounting
 * work from, so the monthly recalc must never keep eroding it.
 */
const DISPOSITION_STATUSES = ["SOLD", "END_OF_LIFE", "STOLEN", "WRITTEN_OFF"] as const;

/**
 * Monthly, at 01:00 on the 1st. Recalculate current book value for every
 * vehicle that has a purchase price + method configured. Vehicles without
 * a depreciation configuration are skipped, as are disposed / soft-deleted
 * vehicles (their book value is frozen at disposition).
 */
export async function runDepreciation(): Promise<number> {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      purchasePrice: { not: null },
      purchaseDate: { not: null },
      depreciationMethod: { not: null },
      depreciationRate: { not: null },
      status: { notIn: [...DISPOSITION_STATUSES] },
      deletedAt: null,
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
