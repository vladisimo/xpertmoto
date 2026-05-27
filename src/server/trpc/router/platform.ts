import { z } from "zod";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import {
  OBSERVABILITY_METRICS,
  estimateCostAud,
  hasCustomPricing,
} from "@/lib/observability-pricing";

/**
 * Platform router — SUPER_ADMIN cost-centre telemetry. Each procedure
 * returns a `source: "live" | "placeholder"` discriminator so the UI can
 * render a "Not yet instrumented" banner where data hasn't been wired.
 */

function windowStarts(): { since24h: Date; since7d: Date; since30d: Date } {
  const now = Date.now();
  return {
    since24h: new Date(now - 24 * 60 * 60 * 1000),
    since7d: new Date(now - 7 * 24 * 60 * 60 * 1000),
    since30d: new Date(now - 30 * 24 * 60 * 60 * 1000),
  };
}

export const platformRouter = createTRPCRouter({
  databaseStats: superAdminProcedure.query(async ({ ctx }) => {
    try {
      const rows = await ctx.prisma.$queryRawUnsafe<
        { db_size_bytes: bigint }[]
      >(`SELECT pg_database_size(current_database())::bigint AS db_size_bytes`);
      const dbSizeBytes = rows[0]?.db_size_bytes
        ? Number(rows[0].db_size_bytes)
        : null;
      return {
        source: "live" as const,
        dbSizeBytes,
      };
    } catch {
      return {
        source: "placeholder" as const,
        reason: "pg_database_size query failed — non-Postgres driver?",
        enableHint: "Run against PostgreSQL.",
        dbSizeBytes: null,
      };
    }
  }),

  serverUsage: superAdminProcedure.query(async ({ ctx }) => {
    const { since24h, since7d, since30d } = windowStarts();
    const [agg24h, agg7d, agg30d, byPath30d] = await Promise.all([
      ctx.prisma.serverRequestLog.aggregate({
        where: { createdAt: { gte: since24h } },
        _count: { _all: true },
        _sum: { sampleWeight: true, bytesOut: true },
      }),
      ctx.prisma.serverRequestLog.aggregate({
        where: { createdAt: { gte: since7d } },
        _count: { _all: true },
        _sum: { sampleWeight: true, bytesOut: true },
      }),
      ctx.prisma.serverRequestLog.aggregate({
        where: { createdAt: { gte: since30d } },
        _count: { _all: true },
        _sum: { sampleWeight: true, bytesOut: true },
      }),
      ctx.prisma.serverRequestLog.groupBy({
        by: ["path"],
        where: { createdAt: { gte: since30d } },
        _count: { _all: true },
        _sum: { sampleWeight: true },
        orderBy: { _count: { path: "desc" } },
        take: 10,
      }),
    ]);
    const hasSamples = (agg30d._count._all ?? 0) > 0;
    return {
      source: hasSamples ? ("live" as const) : ("placeholder" as const),
      reason: hasSamples
        ? undefined
        : "No sampled requests yet. Set PLATFORM_REQUEST_LOGGING=on to start capturing samples in src/proxy.ts.",
      enableHint:
        "bytesOut is null (Next.js middleware can't observe response size). Add a CDN / reverse-proxy analytics pull to populate it.",
      extrapolatedRequests24h: agg24h._sum.sampleWeight ?? 0,
      extrapolatedRequests7d: agg7d._sum.sampleWeight ?? 0,
      extrapolatedRequests30d: agg30d._sum.sampleWeight ?? 0,
      sampledRequests30d: agg30d._count._all ?? 0,
      bytesOut30d: agg30d._sum.bytesOut ?? null,
      topPaths30d: byPath30d.map((row) => ({
        path: row.path,
        sampled: row._count._all,
        extrapolated: row._sum.sampleWeight ?? 0,
      })),
    };
  }),

  storageUsage: superAdminProcedure.query(async ({ ctx }) => {
    const { since30d } = windowStarts();
    const [totalAgg, folders, uploads30d] = await Promise.all([
      ctx.prisma.storageUsageEvent.aggregate({
        _sum: { sizeBytes: true },
        _count: { _all: true },
      }),
      ctx.prisma.storageUsageEvent.groupBy({
        by: ["folder"],
        _sum: { sizeBytes: true },
        _count: { _all: true },
        orderBy: { _sum: { sizeBytes: "desc" } },
      }),
      ctx.prisma.storageUsageEvent.count({
        where: { createdAt: { gte: since30d }, action: "UPLOAD" },
      }),
    ]);
    const totalBytes = totalAgg._sum.sizeBytes ? Number(totalAgg._sum.sizeBytes) : 0;
    const objectCount = totalAgg._count._all ?? 0;
    return {
      source:
        objectCount > 0
          ? ("live" as const)
          : ("placeholder" as const),
      reason:
        objectCount > 0
          ? undefined
          : "No upload events yet. Once a file is uploaded via src/lib/storage.ts this will populate.",
      enableHint:
        "For reconciled totals (vs drift from per-event deltas), layer in a nightly ListObjectsV2 sweep.",
      totalBytes,
      objectCount,
      uploads30d,
      byFolder: folders.map((f) => ({
        folder: f.folder,
        bytes: Number(f._sum.sizeBytes ?? 0),
        events: f._count._all,
      })),
    };
  }),

  llmSummary: superAdminProcedure.query(async ({ ctx }) => {
    const { since24h, since7d, since30d } = windowStarts();

    const [
      supSum24h,
      supSum7d,
      supSum30d,
      supByModel30d,
      ocrSum24h,
      ocrSum7d,
      ocrSum30d,
      ocrByModel30d,
    ] = await Promise.all([
      ctx.prisma.supportCostLog.aggregate({
        where: { createdAt: { gte: since24h } },
        _sum: { costAud: true },
        _count: { _all: true },
      }),
      ctx.prisma.supportCostLog.aggregate({
        where: { createdAt: { gte: since7d } },
        _sum: { costAud: true },
        _count: { _all: true },
      }),
      ctx.prisma.supportCostLog.aggregate({
        where: { createdAt: { gte: since30d } },
        _sum: { costAud: true },
        _count: { _all: true },
      }),
      ctx.prisma.supportCostLog.groupBy({
        by: ["provider", "model"],
        where: { createdAt: { gte: since30d } },
        _sum: {
          costAud: true,
          inputTokens: true,
          outputTokens: true,
          cachedInputTokens: true,
          cacheCreationTokens: true,
        },
        _count: { _all: true },
      }),
      ctx.prisma.ocrCostLog.aggregate({
        where: { createdAt: { gte: since24h } },
        _sum: { costAud: true },
        _count: { _all: true },
      }),
      ctx.prisma.ocrCostLog.aggregate({
        where: { createdAt: { gte: since7d } },
        _sum: { costAud: true },
        _count: { _all: true },
      }),
      ctx.prisma.ocrCostLog.aggregate({
        where: { createdAt: { gte: since30d } },
        _sum: { costAud: true },
        _count: { _all: true },
      }),
      ctx.prisma.ocrCostLog.groupBy({
        by: ["provider", "model", "kind"],
        where: { createdAt: { gte: since30d } },
        _sum: {
          costAud: true,
          inputTokens: true,
          outputTokens: true,
          cachedInputTokens: true,
          cacheCreationTokens: true,
        },
        _count: { _all: true },
      }),
    ]);

    return {
      support: {
        source: "live" as const,
        costAud24h: Number(supSum24h._sum.costAud ?? 0),
        costAud7d: Number(supSum7d._sum.costAud ?? 0),
        costAud30d: Number(supSum30d._sum.costAud ?? 0),
        calls24h: supSum24h._count._all,
        calls7d: supSum7d._count._all,
        calls30d: supSum30d._count._all,
        byModel30d: supByModel30d.map((row) => ({
          provider: row.provider,
          model: row.model,
          costAud: Number(row._sum.costAud ?? 0),
          calls: row._count._all,
          inputTokens: row._sum.inputTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
          cachedInputTokens: row._sum.cachedInputTokens ?? 0,
          cacheCreationTokens: row._sum.cacheCreationTokens ?? 0,
        })),
      },
      ocr: {
        source: "live" as const,
        costAud24h: Number(ocrSum24h._sum.costAud ?? 0),
        costAud7d: Number(ocrSum7d._sum.costAud ?? 0),
        costAud30d: Number(ocrSum30d._sum.costAud ?? 0),
        calls24h: ocrSum24h._count._all,
        calls7d: ocrSum7d._count._all,
        calls30d: ocrSum30d._count._all,
        byModel30d: ocrByModel30d.map((row) => ({
          provider: row.provider,
          model: row.model,
          kind: row.kind,
          costAud: Number(row._sum.costAud ?? 0),
          calls: row._count._all,
          inputTokens: row._sum.inputTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
          cachedInputTokens: row._sum.cachedInputTokens ?? 0,
          cacheCreationTokens: row._sum.cacheCreationTokens ?? 0,
        })),
      },
    };
  }),

  emailUsage: superAdminProcedure.query(async ({ ctx }) => {
    const { since24h, since7d, since30d } = windowStarts();
    const [sent24h, sent7d, sent30d, delivered30d, bounced30d, byProvider30d] =
      await Promise.all([
        ctx.prisma.emailSendLog.count({ where: { createdAt: { gte: since24h } } }),
        ctx.prisma.emailSendLog.count({ where: { createdAt: { gte: since7d } } }),
        ctx.prisma.emailSendLog.count({ where: { createdAt: { gte: since30d } } }),
        ctx.prisma.emailSendLog.count({
          where: { createdAt: { gte: since30d }, deliveredAt: { not: null } },
        }),
        ctx.prisma.emailSendLog.count({
          where: { createdAt: { gte: since30d }, bouncedAt: { not: null } },
        }),
        ctx.prisma.emailSendLog.groupBy({
          by: ["provider"],
          where: { createdAt: { gte: since30d } },
          _count: { _all: true },
        }),
      ]);
    return {
      source: sent30d > 0 ? ("live" as const) : ("placeholder" as const),
      reason:
        sent30d > 0
          ? undefined
          : "No email send events yet — sendEmail() will populate rows once called.",
      enableHint:
        "Resend doesn't return per-email cost. Apply your plan's per-email rate to extrapolate cost in the tab.",
      sent24h,
      sent7d,
      sent30d,
      delivered30d,
      bounced30d,
      byProvider30d: byProvider30d.map((row) => ({
        provider: row.provider,
        count: row._count._all,
      })),
    };
  }),

  smsUsage: superAdminProcedure.query(async ({ ctx }) => {
    const { since24h, since7d, since30d } = windowStarts();
    const [sent24h, sent7d, agg30d, byStatus30d] = await Promise.all([
      ctx.prisma.twilioMessageLog.count({ where: { createdAt: { gte: since24h } } }),
      ctx.prisma.twilioMessageLog.count({ where: { createdAt: { gte: since7d } } }),
      ctx.prisma.twilioMessageLog.aggregate({
        where: { createdAt: { gte: since30d } },
        _count: { _all: true },
        _sum: { numSegments: true, priceAud: true },
      }),
      ctx.prisma.twilioMessageLog.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since30d } },
        _count: { _all: true },
      }),
    ]);
    const sent30d = agg30d._count._all ?? 0;
    return {
      source: sent30d > 0 ? ("live" as const) : ("placeholder" as const),
      reason:
        sent30d > 0
          ? undefined
          : "No SMS sent via the instrumented wrapper yet.",
      enableHint:
        "priceAud is populated by /api/webhooks/twilio using Twilio's Price status-callback field × USD_AUD_RATE.",
      sent24h,
      sent7d,
      sent30d,
      segments30d: agg30d._sum.numSegments ?? 0,
      costAud30d: Number(agg30d._sum.priceAud ?? 0),
      byStatus30d: byStatus30d.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
    };
  }),

  paymentsUsage: superAdminProcedure.query(async ({ ctx }) => {
    const { since30d } = windowStarts();
    const [feeAgg30d, payments30d] = await Promise.all([
      ctx.prisma.stripeFeeLedger.aggregate({
        where: { balanceTxnCreatedAt: { gte: since30d } },
        _sum: { feeAmountCents: true, netAmountCents: true },
        _count: { _all: true },
      }),
      ctx.prisma.payment.aggregate({
        where: {
          status: "SUCCEEDED",
          createdAt: { gte: since30d },
          deletedAt: null,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    const transactions = feeAgg30d._count._all ?? 0;
    const feesCents = feeAgg30d._sum.feeAmountCents ?? 0;
    const netCents = feeAgg30d._sum.netAmountCents ?? 0;
    const feesAud = feesCents / 100;
    const gross = Number(payments30d._sum.amount ?? 0);
    const effectiveFeePct = gross > 0 ? (feesAud / gross) * 100 : 0;
    return {
      source: transactions > 0 ? ("live" as const) : ("placeholder" as const),
      reason:
        transactions > 0
          ? undefined
          : "No StripeFeeLedger rows yet — populated by the nightly stripe-reconcile job.",
      enableHint:
        "Already wired end-to-end: src/server/jobs/stripe-reconcile.ts pulls BalanceTransactions and stores fee amounts.",
      transactionsLast30d: transactions,
      grossProcessedAud: gross,
      feesAud30d: feesAud,
      netAud30d: netCents / 100,
      effectiveFeePct,
      paymentCount30d: payments30d._count._all ?? 0,
    };
  }),

  observabilityUsage: superAdminProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).default(30),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const snapshots = await ctx.prisma.observabilityUsageSnapshot.findMany({
        where: { date: { gte: since } },
        orderBy: { date: "asc" },
      });

      // Per-metric rollup: quantity, derived cost, and a day-over-day delta
      // (most recent day vs the day before it) so the UI can show momentum.
      const byMetric = new Map<
        string,
        { metric: string; quantity: number; costAud: number; lastDay: number; prevDay: number; lastDate: string }
      >();
      // date → metric → quantity, for charting + peak-day + day-over-day.
      const byDate = new Map<string, Map<string, number>>();

      for (const row of snapshots) {
        const dateKey = row.date.toISOString().slice(0, 10);
        const qty = Number(row.quantity);
        const costAud = estimateCostAud(row.metric, qty);

        const agg = byMetric.get(row.metric) ?? {
          metric: row.metric,
          quantity: 0,
          costAud: 0,
          lastDay: 0,
          prevDay: 0,
          lastDate: "",
        };
        agg.quantity += qty;
        agg.costAud += costAud;
        // snapshots are date-asc, so each later row supersedes the "last day".
        if (dateKey !== agg.lastDate) {
          agg.prevDay = agg.lastDate ? agg.lastDay : 0;
          agg.lastDay = qty;
          agg.lastDate = dateKey;
        }
        byMetric.set(row.metric, agg);

        const dateBucket = byDate.get(dateKey) ?? new Map<string, number>();
        dateBucket.set(row.metric, (dateBucket.get(row.metric) ?? 0) + qty);
        byDate.set(dateKey, dateBucket);
      }

      const daysWithData = byDate.size;

      const metrics = Array.from(byMetric.values()).map((m) => ({
        metric: m.metric,
        quantity: m.quantity,
        costAud: m.costAud,
        avgPerDay: daysWithData > 0 ? m.quantity / daysWithData : 0,
        deltaPct:
          m.prevDay > 0 ? ((m.lastDay - m.prevDay) / m.prevDay) * 100 : null,
      }));

      const totalEvents = metrics.reduce((s, m) => s + m.quantity, 0);
      const totalCostAud = metrics.reduce((s, m) => s + m.costAud, 0);

      // One row per day with a column per metric — ready for a stacked chart.
      const chartSeries = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, bucket]) => {
          const error = bucket.get("error") ?? 0;
          const transaction = bucket.get("transaction") ?? 0;
          const replay = bucket.get("replay") ?? 0;
          const attachment = bucket.get("attachment") ?? 0;
          const costAud =
            estimateCostAud("error", error) +
            estimateCostAud("transaction", transaction) +
            estimateCostAud("replay", replay) +
            estimateCostAud("attachment", attachment);
          return {
            date,
            error,
            transaction,
            replay,
            attachment,
            total: error + transaction + replay + attachment,
            costAud,
          };
        });

      const peak = chartSeries.reduce<{ date: string; total: number } | null>(
        (best, row) => (best === null || row.total > best.total ? { date: row.date, total: row.total } : best),
        null,
      );

      return {
        source: snapshots.length > 0 ? ("live" as const) : ("placeholder" as const),
        reason:
          snapshots.length > 0
            ? undefined
            : "No Sentry snapshots yet. Set SENTRY_AUTH_TOKEN + SENTRY_ORG_SLUG; worker runs the pull nightly at 03:45 AEST. Seed history with scripts/backfill-sentry-stats.ts.",
        enableHint:
          "The platform-sentry-stats worker calls Sentry's Stats Summary API (/api/0/organizations/{org}/stats-summary/) nightly and upserts one ObservabilityUsageSnapshot row per metric. Cost is an estimate — override the per-event rate via SENTRY_PRICE_* env.",
        days,
        pricingIsEstimate: !hasCustomPricing(),
        totals: {
          events: totalEvents,
          costAud: totalCostAud,
          // Normalise spend to a 30-day month from whatever history we have.
          projectedMonthlyCostAud: daysWithData > 0 ? (totalCostAud / daysWithData) * 30 : 0,
          daysWithData,
        },
        peak,
        metrics,
        chartSeries,
      };
    }),
});
