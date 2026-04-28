import type { PrismaClient } from "@prisma/client";
import type {
  InsightsGeneratorContext,
  RepeatCohortPayload,
} from "../types";

const COHORT_MONTHS = 12;
const LOOKBACK_MONTHS = 6;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export async function generateRepeatCohort(
  prisma: PrismaClient,
  ctx: InsightsGeneratorContext,
): Promise<RepeatCohortPayload> {
  const end = new Date(ctx.now.getFullYear(), ctx.now.getMonth() + 1, 1);
  const start = new Date(end.getFullYear(), end.getMonth() - COHORT_MONTHS, 1);

  const bookings = await prisma.booking.findMany({
    where: {
      pickupDateTime: { gte: start, lt: end },
      status: { notIn: ["CANCELLED", "NO_SHOW", "QUOTE"] },
      ...(ctx.depotId ? { pickupDepotId: ctx.depotId } : {}),
    },
    select: {
      customerId: true,
      pickupDateTime: true,
    },
    orderBy: { pickupDateTime: "asc" },
  });

  const firstBookingPerCustomer = new Map<string, Date>();
  for (const b of bookings) {
    if (!firstBookingPerCustomer.has(b.customerId)) {
      firstBookingPerCustomer.set(b.customerId, b.pickupDateTime);
    }
  }

  const cohortMap = new Map<
    string,
    { customers: Set<string>; returnedByMonth: number[] }
  >();
  for (let i = 0; i < COHORT_MONTHS; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    cohortMap.set(monthKey(d), {
      customers: new Set(),
      returnedByMonth: Array.from({ length: LOOKBACK_MONTHS }, () => 0),
    });
  }

  for (const [customerId, firstDate] of firstBookingPerCustomer) {
    const key = monthKey(firstDate);
    const cohort = cohortMap.get(key);
    if (cohort) cohort.customers.add(customerId);
  }

  const returnedPerCohort = new Map<string, Set<string>[]>();
  for (const key of cohortMap.keys()) {
    returnedPerCohort.set(
      key,
      Array.from({ length: LOOKBACK_MONTHS }, () => new Set<string>()),
    );
  }
  for (const b of bookings) {
    const first = firstBookingPerCustomer.get(b.customerId);
    if (!first) continue;
    const firstKey = monthKey(first);
    const buckets = returnedPerCohort.get(firstKey);
    if (!buckets) continue;
    const offset = monthsBetween(first, b.pickupDateTime);
    if (offset >= 1 && offset <= LOOKBACK_MONTHS) {
      const bucket = buckets[offset - 1];
      if (bucket) bucket.add(b.customerId);
    }
  }

  const cohorts: RepeatCohortPayload["cohorts"] = [];
  let totalNew = 0;
  let totalReturnedAny = 0;
  let best: RepeatCohortPayload["bestCohort"] = null;

  for (const [key, entry] of cohortMap) {
    const size = entry.customers.size;
    const returnedByMonth = (returnedPerCohort.get(key) ?? []).map((s) => s.size);
    const everReturned = new Set<string>();
    for (const s of returnedPerCohort.get(key) ?? []) {
      for (const id of s) everReturned.add(id);
    }
    totalNew += size;
    totalReturnedAny += everReturned.size;
    if (size >= 5) {
      const rate = everReturned.size / size;
      if (!best || rate > best.rate) {
        best = { month: key, rate: Number(rate.toFixed(4)) };
      }
    }
    cohorts.push({
      cohortMonth: key,
      newCustomers: size,
      returnedByMonth,
    });
  }

  const overallRepeatRate =
    totalNew > 0 ? Number((totalReturnedAny / totalNew).toFixed(4)) : 0;

  return {
    id: "repeat-cohort",
    cohorts,
    overallRepeatRate,
    bestCohort: best,
    headlineMetric: {
      label: "Repeat rate (12-month average)",
      value: `${Math.round(overallRepeatRate * 100)}%`,
    },
  };
}
