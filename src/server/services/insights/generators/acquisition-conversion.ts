import type { PrismaClient } from "@prisma/client";
import type {
  AcquisitionConversionPayload,
  InsightsGeneratorContext,
} from "../types";

const WINDOW_DAYS = 30;
const MIN_SESSIONS_FOR_RANK = 20;

export async function generateAcquisitionConversion(
  prisma: PrismaClient,
  ctx: InsightsGeneratorContext,
): Promise<AcquisitionConversionPayload> {
  const end = ctx.now;
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);

  const rows = await prisma.visitorSession.groupBy({
    by: ["utmSource"],
    where: {
      startedAt: { gte: start, lt: end },
    },
    _count: { _all: true },
  });

  const convertedRows = await prisma.visitorSession.groupBy({
    by: ["utmSource"],
    where: {
      startedAt: { gte: start, lt: end },
      outcome: "CONVERTED",
    },
    _count: { _all: true },
  });
  const convertedBySource = new Map<string, number>();
  for (const r of convertedRows) {
    convertedBySource.set(r.utmSource ?? "(direct)", r._count._all);
  }

  let totalSessions = 0;
  let totalBookings = 0;
  const sources = rows.map((r) => {
    const source = r.utmSource ?? "(direct)";
    const sessions = r._count._all;
    const bookings = convertedBySource.get(source) ?? 0;
    totalSessions += sessions;
    totalBookings += bookings;
    return {
      source,
      sessions,
      bookings,
      conversionRate:
        sessions > 0 ? Number(((bookings / sessions) * 100).toFixed(2)) : 0,
    };
  });

  sources.sort((a, b) => b.sessions - a.sessions);

  const ranked = sources.filter((s) => s.sessions >= MIN_SESSIONS_FOR_RANK);
  let best: AcquisitionConversionPayload["bestSource"] = null;
  let worst: AcquisitionConversionPayload["worstSource"] = null;
  if (ranked.length > 0) {
    const sortedByRate = [...ranked].sort(
      (a, b) => b.conversionRate - a.conversionRate,
    );
    const first = sortedByRate[0];
    const last = sortedByRate[sortedByRate.length - 1];
    if (first) {
      best = { source: first.source, conversionRate: first.conversionRate };
    }
    if (last) {
      worst = { source: last.source, conversionRate: last.conversionRate };
    }
  }

  const overall =
    totalSessions > 0
      ? Number(((totalBookings / totalSessions) * 100).toFixed(2))
      : 0;

  return {
    id: "acquisition-conversion",
    sources,
    bestSource: best,
    worstSource: worst,
    overallConversionRate: overall,
    headlineMetric: {
      label: `Overall conversion (last ${WINDOW_DAYS} days)`,
      value: `${overall.toFixed(2)}%`,
      trendLabel:
        best && best.conversionRate > overall
          ? `${best.source} leads at ${best.conversionRate.toFixed(2)}%`
          : undefined,
    },
  };
}
