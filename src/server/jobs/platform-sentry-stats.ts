/**
 * Daily Sentry stats pull → ObservabilityUsageSnapshot.
 *
 * Calls Sentry's Stats Summary API (/api/0/organizations/{org}/stats-summary/)
 * once per metric for the previous UTC day and upserts one row per metric.
 * Cost is NOT stored — it is derived on read from @/lib/observability-pricing
 * so re-pricing is just an env change.
 *
 * Requires env:
 *   SENTRY_AUTH_TOKEN    — an auth token with `org:read` scope
 *   SENTRY_ORG_SLUG      — e.g. "xpertmoto"
 *   SENTRY_API_BASE_URL  — optional; defaults to https://sentry.io
 *
 * Schedule the queue `platform-sentry-stats` daily (03:45 Brisbane is a
 * good spot — after db-backup-retention at 03:15). Historical days can be
 * seeded with scripts/backfill-sentry-stats.ts (uses backfillSentryStats).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { OBSERVABILITY_METRICS } from "@/lib/observability-pricing";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "platform-sentry-stats" as const;

type SentryStatsSummaryResponse = {
  start: string;
  end: string;
  projects: Array<{
    id: number;
    slug: string;
    stats: Array<{
      category: string;
      outcomes: Record<string, number>;
      totals: { "sum(quantity)"?: number; dropped?: number };
    }>;
  }>;
};

export type SentryStatsJobResult = {
  snapshotted: number;
  date: string;
  skipped?: string;
};

export type SentryStatsBackfillResult = {
  days: number;
  snapshotted: number;
  from: string;
  to: string;
  skipped?: string;
};

/** Midnight-UTC `Date` for the day `offsetDays` before `from`. */
function utcDayStart(from: Date, offsetDays = 0): Date {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - offsetDays),
  );
}

/**
 * Fetch the accepted-event count for one metric over [dayStart, dayStart+1d).
 * Returns null on a non-OK response (logged) so callers can skip that metric.
 */
async function fetchAcceptedQuantity(opts: {
  token: string;
  org: string;
  base: string;
  category: string;
  dayStart: Date;
}): Promise<number | null> {
  const { token, org, base, category, dayStart } = opts;
  const url = new URL(`/api/0/organizations/${org}/stats-summary/`, base);
  url.searchParams.set("field", "sum(quantity)");
  url.searchParams.set("groupBy", "outcome");
  url.searchParams.set("category", category);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("start", dayStart.toISOString());
  url.searchParams.set("end", new Date(dayStart.getTime() + 86_400_000).toISOString());

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    logger.warn({ status: res.status, category }, "sentry stats pull failed");
    return null;
  }
  const json = (await res.json()) as SentryStatsSummaryResponse;
  // stats-summary groups per project; sum the accepted quantity for this
  // category across every project in the org.
  return (json.projects ?? []).reduce(
    (sum, project) =>
      sum +
      (project.stats ?? [])
        .filter((stat) => stat.category === category)
        .reduce((acc, stat) => acc + (stat.outcomes?.accepted ?? 0), 0),
    0,
  );
}

/** Upsert every metric's snapshot for a single UTC day. Returns rows written. */
async function snapshotDay(opts: {
  token: string;
  org: string;
  base: string;
  dayStart: Date;
}): Promise<number> {
  let written = 0;
  for (const category of OBSERVABILITY_METRICS) {
    const total = await fetchAcceptedQuantity({ ...opts, category });
    if (total === null) continue;
    const quantity = BigInt(Math.max(0, Math.round(total)));
    await prisma.observabilityUsageSnapshot.upsert({
      where: {
        provider_metric_date: { provider: "sentry", metric: category, date: opts.dayStart },
      },
      create: { provider: "sentry", metric: category, date: opts.dayStart, quantity },
      update: { quantity },
    });
    written += 1;
  }
  return written;
}

function sentryEnv(): { token: string; org: string; base: string } | null {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG;
  if (!token || !org) return null;
  return { token, org, base: process.env.SENTRY_API_BASE_URL ?? "https://sentry.io" };
}

export async function runPlatformSentryStats(): Promise<SentryStatsJobResult> {
  const env = sentryEnv();
  if (!env) {
    return { snapshotted: 0, date: "", skipped: "missing SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG" };
  }
  const yesterday = utcDayStart(new Date(), 1);
  const snapshotted = await snapshotDay({ ...env, dayStart: yesterday });
  return { snapshotted, date: yesterday.toISOString().slice(0, 10) };
}

/**
 * Seed history: snapshot each of the `days` UTC days ending yesterday.
 * Idempotent (upsert per day+metric), so safe to re-run.
 */
export async function backfillSentryStats(days: number): Promise<SentryStatsBackfillResult> {
  const env = sentryEnv();
  if (!env) {
    return { days, snapshotted: 0, from: "", to: "", skipped: "missing SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG" };
  }
  const now = new Date();
  let snapshotted = 0;
  let from = "";
  let to = "";
  // Oldest → newest: day `days` ago through yesterday (offset 1).
  for (let offset = days; offset >= 1; offset--) {
    const dayStart = utcDayStart(now, offset);
    const iso = dayStart.toISOString().slice(0, 10);
    if (!from) from = iso;
    to = iso;
    snapshotted += await snapshotDay({ ...env, dayStart });
  }
  return { days, snapshotted, from, to };
}

export function startPlatformSentryStatsScheduler(): void {
  registerWorker(QUEUE, async () => {
    const result = await runPlatformSentryStats();
    logger.info(result, "platform-sentry-stats done");
  });
  const q = getQueue(QUEUE);
  if (q) {
    // 03:45 Brisbane — after db-backup-retention at 03:15.
    const schedule = process.env.PLATFORM_SENTRY_STATS_CRON ?? "45 3 * * *";
    q.add(
      "daily",
      {},
      { repeat: { pattern: schedule, tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
    );
  }
}
