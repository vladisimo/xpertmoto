/**
 * Daily Sentry stats pull → ObservabilityUsageSnapshot.
 *
 * Calls Sentry's Organizations Stats v2 API for the previous UTC day and
 * upserts one row per metric. Cost is left null — set per-event pricing
 * in the Platform > Observability tab once your plan is known.
 *
 * Requires env:
 *   SENTRY_AUTH_TOKEN    — an auth token with `org:read` scope
 *   SENTRY_ORG_SLUG      — e.g. "scootering"
 *   SENTRY_API_BASE_URL  — optional; defaults to https://sentry.io
 *
 * Schedule the queue `platform-sentry-stats` daily (03:45 Brisbane is a
 * good spot — after db-backup-retention at 03:15).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "platform-sentry-stats" as const;

const CATEGORIES = ["error", "transaction", "replay", "attachment"] as const;

type SentryStatsResponse = {
  intervals: string[];
  groups: Array<{
    by: { category?: string; outcome?: string };
    totals: { "sum(quantity)"?: number };
  }>;
};

export type SentryStatsJobResult = {
  snapshotted: number;
  date: string;
  skipped?: string;
};

export async function runPlatformSentryStats(): Promise<SentryStatsJobResult> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG;
  if (!token || !org) {
    return { snapshotted: 0, date: "", skipped: "missing SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG" };
  }
  const base = process.env.SENTRY_API_BASE_URL ?? "https://sentry.io";

  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = yesterday.toISOString();
  const end = new Date(yesterday.getTime() + 24 * 60 * 60 * 1000).toISOString();

  let snapshotted = 0;

  for (const category of CATEGORIES) {
    const url = new URL(`/api/0/organizations/${org}/stats-summary/`, base);
    url.searchParams.set("field", "sum(quantity)");
    url.searchParams.set("groupBy", "outcome");
    url.searchParams.set("category", category);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, category }, "sentry stats pull failed");
      continue;
    }
    const json = (await res.json()) as SentryStatsResponse;
    const total = json.groups
      .filter((g) => g.by.outcome === "accepted" || g.by.outcome === undefined)
      .reduce((sum, g) => sum + (g.totals["sum(quantity)"] ?? 0), 0);

    const dateOnly = new Date(
      Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()),
    );
    await prisma.observabilityUsageSnapshot.upsert({
      where: {
        provider_metric_date: {
          provider: "sentry",
          metric: category,
          date: dateOnly,
        },
      },
      create: {
        provider: "sentry",
        metric: category,
        date: dateOnly,
        quantity: BigInt(Math.max(0, Math.round(total))),
      },
      update: {
        quantity: BigInt(Math.max(0, Math.round(total))),
      },
    });
    snapshotted += 1;
  }

  return { snapshotted, date: yesterday.toISOString().slice(0, 10) };
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
