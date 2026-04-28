import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, staffProcedure } from "../trpc";

/**
 * Shared analytics filter shape — accepted by every summary procedure
 * in this router (overviewSummary, acquisition, behaviour, conversion,
 * retention). All fields are optional; sessionsList accepts the same
 * keys so a drill-down from any widget produces a matching session
 * list without an extra mapping layer.
 */
const ANALYTICS_FILTER = z.object({
  range: z.enum(["TODAY", "7D", "30D", "90D"]).default("7D"),
  compare: z.boolean().default(false),
  segment: z.enum(["ALL", "MOBILE", "DESKTOP", "TABLET", "BOT_EXCL"]).default("ALL"),
  country: z.string().length(2).optional(),
  landingPath: z.string().min(1).max(500).optional(),
  utmSource: z.string().min(1).max(200).optional(),
  utmMedium: z.string().min(1).max(200).optional(),
  utmCampaign: z.string().min(1).max(200).optional(),
  referrerDomain: z.string().min(1).max(200).optional(),
  wizardStepEq: z.number().int().min(1).max(6).optional(),
  dow: z.number().int().min(0).max(6).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  // Wizard-state drill-downs (Slice 3) — filter sessions by what was in
  // the visitor's cart at last heartbeat.
  pickupDepotId: z.string().min(1).max(64).optional(),
  categoryId: z.string().min(1).max(64).optional(),
  vehicleId: z.string().min(1).max(64).optional(),
  discountCode: z.string().min(1).max(64).optional(),
});

export type AnalyticsFilterInput = z.infer<typeof ANALYTICS_FILTER>;

const RANGE_DAYS = { TODAY: 1, "7D": 7, "30D": 30, "90D": 90 } as const;
type RangeKey = keyof typeof RANGE_DAYS;

interface PeriodBounds {
  from: Date;
  to: Date;
}

function rangeBounds(range: RangeKey): PeriodBounds {
  const to = new Date();
  const from = new Date();
  if (range === "TODAY") {
    from.setHours(0, 0, 0, 0);
  } else {
    from.setDate(from.getDate() - RANGE_DAYS[range]);
  }
  return { from, to };
}

function previousBounds(current: PeriodBounds): PeriodBounds {
  const spanMs = current.to.getTime() - current.from.getTime();
  return { from: new Date(current.from.getTime() - spanMs), to: current.from };
}

function segmentWhere(segment: AnalyticsFilterInput["segment"]): Prisma.VisitorSessionWhereInput {
  switch (segment) {
    case "MOBILE":
      return { deviceType: "MOBILE" };
    case "DESKTOP":
      return { deviceType: "DESKTOP" };
    case "TABLET":
      return { deviceType: "TABLET" };
    case "BOT_EXCL":
      return { deviceType: { not: "BOT" } };
    case "ALL":
    default:
      return {};
  }
}

/**
 * Build a Prisma `where` for VisitorSession from analytics filter input.
 * Hour-of-day and day-of-week are expressed as raw SQL fragments — they
 * require a post-filter since Prisma has no native DoW/hour extractors.
 */
function buildSessionWhere(
  bounds: PeriodBounds,
  filter: AnalyticsFilterInput,
): { where: Prisma.VisitorSessionWhereInput; rawTimeClause: Prisma.Sql } {
  const where: Prisma.VisitorSessionWhereInput = {
    startedAt: { gte: bounds.from, lte: bounds.to },
    ...segmentWhere(filter.segment),
    ...(filter.country ? { country: filter.country } : {}),
    ...(filter.landingPath ? { landingPath: filter.landingPath } : {}),
    ...(filter.utmSource ? { utmSource: filter.utmSource } : {}),
    ...(filter.utmMedium ? { utmMedium: filter.utmMedium } : {}),
    ...(filter.utmCampaign ? { utmCampaign: filter.utmCampaign } : {}),
    ...(filter.referrerDomain ? { referrer: filter.referrerDomain } : {}),
    ...(filter.wizardStepEq != null ? { wizardHighestStep: filter.wizardStepEq } : {}),
    ...(filter.pickupDepotId ? { pickupDepotId: filter.pickupDepotId } : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
    ...(filter.discountCode ? { discountCode: filter.discountCode } : {}),
  };

  // Raw SQL fragments for use in $queryRaw variants that bypass Prisma filters
  // (hour/dow aren't representable in a Prisma where clause).
  const timeFragments: Prisma.Sql[] = [];
  if (filter.hour != null) {
    timeFragments.push(Prisma.sql`EXTRACT(HOUR FROM "startedAt") = ${filter.hour}`);
  }
  if (filter.dow != null) {
    timeFragments.push(Prisma.sql`EXTRACT(DOW FROM "startedAt") = ${filter.dow}`);
  }
  const rawTimeClause =
    timeFragments.length > 0
      ? Prisma.sql`AND ${Prisma.join(timeFragments, " AND ")}`
      : Prisma.empty;
  return { where, rawTimeClause };
}

/**
 * Combined raw SQL filter for $queryRaw queries (covers segment +
 * country + utm + referrer + wizard step + hour + dow). Matches
 * `buildSessionWhere` exactly — if you add a field there, add it here.
 */
function buildRawFilterSql(bounds: PeriodBounds, filter: AnalyticsFilterInput): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`"startedAt" >= ${bounds.from}`,
    Prisma.sql`"startedAt" <= ${bounds.to}`,
  ];
  if (filter.segment === "MOBILE") parts.push(Prisma.sql`"deviceType"::text = 'MOBILE'`);
  else if (filter.segment === "DESKTOP") parts.push(Prisma.sql`"deviceType"::text = 'DESKTOP'`);
  else if (filter.segment === "TABLET") parts.push(Prisma.sql`"deviceType"::text = 'TABLET'`);
  else if (filter.segment === "BOT_EXCL") parts.push(Prisma.sql`"deviceType"::text <> 'BOT'`);
  if (filter.country) parts.push(Prisma.sql`"country" = ${filter.country}`);
  if (filter.landingPath) parts.push(Prisma.sql`"landingPath" = ${filter.landingPath}`);
  if (filter.utmSource) parts.push(Prisma.sql`"utmSource" = ${filter.utmSource}`);
  if (filter.utmMedium) parts.push(Prisma.sql`"utmMedium" = ${filter.utmMedium}`);
  if (filter.utmCampaign) parts.push(Prisma.sql`"utmCampaign" = ${filter.utmCampaign}`);
  if (filter.referrerDomain) parts.push(Prisma.sql`"referrer" = ${filter.referrerDomain}`);
  if (filter.wizardStepEq != null) parts.push(Prisma.sql`"wizardHighestStep" = ${filter.wizardStepEq}`);
  if (filter.hour != null) parts.push(Prisma.sql`EXTRACT(HOUR FROM "startedAt") = ${filter.hour}`);
  if (filter.dow != null) parts.push(Prisma.sql`EXTRACT(DOW FROM "startedAt") = ${filter.dow}`);
  if (filter.pickupDepotId) parts.push(Prisma.sql`"pickupDepotId" = ${filter.pickupDepotId}`);
  if (filter.categoryId) parts.push(Prisma.sql`"categoryId" = ${filter.categoryId}`);
  if (filter.vehicleId) parts.push(Prisma.sql`"vehicleId" = ${filter.vehicleId}`);
  if (filter.discountCode) parts.push(Prisma.sql`"discountCode" = ${filter.discountCode}`);
  return Prisma.join(parts, " AND ");
}

interface OverviewTotals {
  totalSessions: number;
  uniqueVisitors: number;
  converted: number;
  abandonedWizard: number;
  bounced: number;
  left: number;
  conversionRate: number;
  avgDurationSeconds: number;
}

async function computeTotals(
  prisma: PrismaClient,
  bounds: PeriodBounds,
  filter: AnalyticsFilterInput,
): Promise<OverviewTotals> {
  const { where } = buildSessionWhere(bounds, filter);
  const [
    totalSessions,
    uniqueVisitors,
    converted,
    abandonedWizard,
    bounced,
    left,
    avgDuration,
  ] = await Promise.all([
    prisma.visitorSession.count({ where }),
    prisma.visitorSession.groupBy({
      by: ["ipHash"],
      where: { ...where, ipHash: { not: null } },
      _count: { _all: true },
    }),
    prisma.visitorSession.count({ where: { ...where, outcome: "CONVERTED" } }),
    prisma.visitorSession.count({ where: { ...where, outcome: "ABANDONED_WIZARD" } }),
    prisma.visitorSession.count({ where: { ...where, outcome: "BOUNCED" } }),
    prisma.visitorSession.count({ where: { ...where, outcome: "LEFT" } }),
    prisma.visitorSession.aggregate({
      where: { ...where, durationSeconds: { not: null } },
      _avg: { durationSeconds: true },
    }),
  ]);
  return {
    totalSessions,
    uniqueVisitors: uniqueVisitors.length,
    converted,
    abandonedWizard,
    bounced,
    left,
    conversionRate: totalSessions > 0 ? converted / totalSessions : 0,
    avgDurationSeconds: Math.round(avgDuration._avg.durationSeconds ?? 0),
  };
}

export const liveAnalyticsRouter = createTRPCRouter({
  /**
   * Overview-tab summary. Totals with optional previous-period deltas,
   * device mix, outcome breakdown, wizard funnel with drop-off %, and
   * the day-of-week × hour-of-day heatmap. All widgets on the Overview
   * tab read from this single response.
   */
  overviewSummary: staffProcedure
    .input(ANALYTICS_FILTER)
    .query(async ({ ctx, input }) => {
      const current = rangeBounds(input.range);
      const { where } = buildSessionWhere(current, input);

      const [totals, previous, deviceGroups, dowHourRows, funnelGroups, deviceConversionRows] =
        await Promise.all([
          computeTotals(ctx.prisma, current, input),
          input.compare
            ? computeTotals(ctx.prisma, previousBounds(current), input)
            : Promise.resolve(null),
          ctx.prisma.visitorSession.groupBy({
            by: ["deviceType"],
            where: { ...where, deviceType: { not: null } },
            _count: { _all: true },
          }),
          ctx.prisma.$queryRaw<Array<{ dow: number; hour: number; count: bigint }>>(Prisma.sql`
            SELECT EXTRACT(DOW FROM "startedAt")::int AS dow,
                   EXTRACT(HOUR FROM "startedAt")::int AS hour,
                   COUNT(*)::bigint AS count
            FROM "VisitorSession"
            WHERE ${buildRawFilterSql(current, input)}
            GROUP BY 1, 2
            ORDER BY 1, 2
          `),
          ctx.prisma.visitorSession.groupBy({
            by: ["wizardHighestStep"],
            where,
            _count: { _all: true },
          }),
          // Per-device benchmarks — total + converted sessions per
          // deviceType. Drives the "Your mobile conversion is X%"
          // callout on the Overview tab.
          ctx.prisma.$queryRaw<
            Array<{ deviceType: string; total: bigint; converted: bigint }>
          >(Prisma.sql`
            SELECT "deviceType"::text AS "deviceType",
                   COUNT(*)::bigint AS total,
                   SUM(CASE WHEN "outcome"::text = 'CONVERTED' THEN 1 ELSE 0 END)::bigint AS converted
            FROM "VisitorSession"
            WHERE ${buildRawFilterSql(current, input)}
              AND "deviceType" IS NOT NULL
            GROUP BY "deviceType"
          `),
        ]);

      // Cumulative funnel (reached step N): every session whose
      // highest-step >= N. Drop-off % compares N+1/N.
      const stepCounts: Record<number, number> = {};
      let noWizard = 0;
      for (const g of funnelGroups) {
        if (g.wizardHighestStep == null) noWizard += g._count._all;
        else stepCounts[g.wizardHighestStep] = (stepCounts[g.wizardHighestStep] ?? 0) + g._count._all;
      }
      const funnel: Array<{ step: number; reached: number; dropOffRate: number | null }> = [];
      for (let step = 1; step <= 6; step++) {
        let reached = 0;
        for (const [k, v] of Object.entries(stepCounts)) {
          if (Number(k) >= step) reached += v;
        }
        const prev = funnel[funnel.length - 1];
        const dropOffRate =
          prev && prev.reached > 0 ? Math.max(0, 1 - reached / prev.reached) : null;
        funnel.push({ step, reached, dropOffRate });
      }

      // Dense 7×24 matrix — empty cells are zero so the heatmap doesn't
      // need to worry about missing cells.
      const dowHourMatrix: Array<{ dow: number; hour: number; count: number }> = [];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const row = dowHourRows.find((r) => r.dow === d && r.hour === h);
          dowHourMatrix.push({ dow: d, hour: h, count: row ? Number(row.count) : 0 });
        }
      }

      return {
        range: input.range,
        current,
        previous: input.compare ? previousBounds(current) : null,
        totals,
        previousTotals: previous,
        device: deviceGroups.map((g) => ({ type: g.deviceType, count: g._count._all })),
        funnel,
        noWizardVisitors: noWizard,
        dowHourMatrix,
        deviceBenchmarks: deviceConversionRows.map((r) => ({
          deviceType: r.deviceType,
          total: Number(r.total),
          converted: Number(r.converted),
          conversionRate: Number(r.total) > 0 ? Number(r.converted) / Number(r.total) : 0,
        })),
      };
    }),

  /**
   * Acquisition-tab aggregates: channel classification, top UTM source/
   * medium/campaign, top referrer domains, landing-page conversion rate,
   * and geo (country / region / city) breakdowns.
   */
  acquisition: staffProcedure
    .input(ANALYTICS_FILTER)
    .query(async ({ ctx, input }) => {
      const current = rangeBounds(input.range);
      const { where } = buildSessionWhere(current, input);

      const [
        totalSessions,
        utmSourceGroups,
        utmMediumGroups,
        utmCampaignGroups,
        referrerGroups,
        landingGroups,
        countryGroups,
        regionGroups,
        cityGroups,
        landingConversionRows,
      ] = await Promise.all([
        ctx.prisma.visitorSession.count({ where }),
        ctx.prisma.visitorSession.groupBy({
          by: ["utmSource"],
          where: { ...where, utmSource: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { utmSource: "desc" } },
          take: 20,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["utmMedium"],
          where: { ...where, utmMedium: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { utmMedium: "desc" } },
          take: 20,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["utmCampaign"],
          where: { ...where, utmCampaign: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { utmCampaign: "desc" } },
          take: 20,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["referrer"],
          where: { ...where, referrer: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { referrer: "desc" } },
          take: 20,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["landingPath"],
          where: { ...where, landingPath: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { landingPath: "desc" } },
          take: 20,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["country"],
          where: { ...where, country: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { country: "desc" } },
          take: 20,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["country", "region"],
          where: { ...where, region: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { region: "desc" } },
          take: 25,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["country", "region", "city"],
          where: { ...where, city: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { city: "desc" } },
          take: 25,
        }),
        // Per-landing conversion rate — single raw query so we get
        // converted/total in one round trip.
        ctx.prisma.$queryRaw<
          Array<{ landingPath: string; total: bigint; converted: bigint }>
        >(Prisma.sql`
          SELECT "landingPath",
                 COUNT(*)::bigint AS total,
                 SUM(CASE WHEN "outcome"::text = 'CONVERTED' THEN 1 ELSE 0 END)::bigint AS converted
          FROM "VisitorSession"
          WHERE ${buildRawFilterSql(current, input)}
            AND "landingPath" IS NOT NULL
          GROUP BY "landingPath"
          ORDER BY total DESC
          LIMIT 20
        `),
      ]);

      // `trafficChannel` is stamped at session-create time (Slice 2) and
      // backfilled for historical rows by the migration. A groupBy
      // replaces the prior findMany(10k)-then-classify-in-JS path.
      const channelGroups = await ctx.prisma.visitorSession.groupBy({
        by: ["trafficChannel"],
        where,
        _count: { _all: true },
        orderBy: { _count: { trafficChannel: "desc" } },
      });
      const channel = channelGroups.map((g) => ({
        channel: g.trafficChannel ?? "OTHER",
        count: g._count._all,
      }));

      return {
        totalSessions,
        channel,
        utmSource: utmSourceGroups.map((g) => ({ value: g.utmSource, count: g._count._all })),
        utmMedium: utmMediumGroups.map((g) => ({ value: g.utmMedium, count: g._count._all })),
        utmCampaign: utmCampaignGroups.map((g) => ({ value: g.utmCampaign, count: g._count._all })),
        referrer: referrerGroups.map((g) => ({ value: g.referrer, count: g._count._all })),
        landing: landingGroups.map((g) => ({ path: g.landingPath, count: g._count._all })),
        landingConversion: landingConversionRows.map((r) => ({
          path: r.landingPath,
          total: Number(r.total),
          converted: Number(r.converted),
          conversionRate: Number(r.total) > 0 ? Number(r.converted) / Number(r.total) : 0,
        })),
        country: countryGroups.map((g) => ({ country: g.country, count: g._count._all })),
        region: regionGroups.map((g) => ({
          country: g.country,
          region: g.region,
          count: g._count._all,
        })),
        city: cityGroups.map((g) => ({
          country: g.country,
          region: g.region,
          city: g.city,
          count: g._count._all,
        })),
      };
    }),

  /**
   * Behaviour-tab aggregates: day×hour heatmap, top page paths with
   * average time-on-page, and the distribution of sessions by page-view
   * bucket.
   */
  behaviour: staffProcedure
    .input(ANALYTICS_FILTER)
    .query(async ({ ctx, input }) => {
      const current = rangeBounds(input.range);
      const { where } = buildSessionWhere(current, input);
      const rawFilter = buildRawFilterSql(current, input);

      const [
        totalSessions,
        dowHourRows,
        topPages,
        pageDepthGroups,
        topCtaRows,
        topFleetClickRows,
        topFleetViewRows,
        topSearchRows,
        discountFunnelRows,
        engagementSignalRows,
        scrollDepthRows,
        engagementScoreAgg,
      ] = await Promise.all([
        ctx.prisma.visitorSession.count({ where }),
        ctx.prisma.$queryRaw<Array<{ dow: number; hour: number; count: bigint }>>(Prisma.sql`
          SELECT EXTRACT(DOW FROM "startedAt")::int AS dow,
                 EXTRACT(HOUR FROM "startedAt")::int AS hour,
                 COUNT(*)::bigint AS count
          FROM "VisitorSession"
          WHERE ${buildRawFilterSql(current, input)}
          GROUP BY 1, 2
          ORDER BY 1, 2
        `),
        // Top pages joined with avg dwell from VisitorPageView.
        ctx.prisma.$queryRaw<
          Array<{ path: string; views: bigint; avg_ms: number | null }>
        >(Prisma.sql`
          SELECT pv."path" AS path,
                 COUNT(*)::bigint AS views,
                 AVG(pv."durationMs")::float AS avg_ms
          FROM "VisitorPageView" pv
          INNER JOIN "VisitorSession" s ON s."id" = pv."sessionId"
          WHERE ${buildRawFilterSql(current, input)}
          GROUP BY pv."path"
          ORDER BY views DESC
          LIMIT 20
        `),
        ctx.prisma.visitorSession.groupBy({
          by: ["totalPageViews"],
          where,
          _count: { _all: true },
        }),
        // CTA click leaderboard — target carries the data-track value.
        ctx.prisma.$queryRaw<Array<{ target: string; count: bigint }>>(Prisma.sql`
          SELECT ev."target" AS target, COUNT(*)::bigint AS count
          FROM "VisitorEvent" ev
          INNER JOIN "VisitorSession" s ON s."id" = ev."sessionId"
          WHERE ${rawFilter}
            AND ev."kind"::text = 'CTA_CLICK'
            AND ev."target" IS NOT NULL
          GROUP BY ev."target"
          ORDER BY count DESC
          LIMIT 15
        `),
        // Fleet clicks — target is the vehicleId or categoryId attribute.
        ctx.prisma.$queryRaw<Array<{ target: string; count: bigint }>>(Prisma.sql`
          SELECT ev."target" AS target, COUNT(*)::bigint AS count
          FROM "VisitorEvent" ev
          INNER JOIN "VisitorSession" s ON s."id" = ev."sessionId"
          WHERE ${rawFilter}
            AND ev."kind"::text = 'FLEET_CLICK'
            AND ev."target" IS NOT NULL
          GROUP BY ev."target"
          ORDER BY count DESC
          LIMIT 15
        `),
        // Fleet views (card entered viewport) — volume per target.
        ctx.prisma.$queryRaw<Array<{ target: string; count: bigint }>>(Prisma.sql`
          SELECT ev."target" AS target, COUNT(*)::bigint AS count
          FROM "VisitorEvent" ev
          INNER JOIN "VisitorSession" s ON s."id" = ev."sessionId"
          WHERE ${rawFilter}
            AND ev."kind"::text = 'FLEET_VIEW'
            AND ev."target" IS NOT NULL
          GROUP BY ev."target"
          ORDER BY count DESC
          LIMIT 15
        `),
        // Top searches — value is the submitted search query (sanitised).
        ctx.prisma.$queryRaw<Array<{ value: string; count: bigint }>>(Prisma.sql`
          SELECT ev."value" AS value, COUNT(*)::bigint AS count
          FROM "VisitorEvent" ev
          INNER JOIN "VisitorSession" s ON s."id" = ev."sessionId"
          WHERE ${rawFilter}
            AND ev."kind"::text = 'SEARCH'
            AND ev."value" IS NOT NULL
          GROUP BY ev."value"
          ORDER BY count DESC
          LIMIT 15
        `),
        // Discount code funnel — per code: attempted / applied / rejected counts.
        ctx.prisma.$queryRaw<
          Array<{ value: string; attempted: bigint; applied: bigint; rejected: bigint }>
        >(Prisma.sql`
          SELECT ev."value" AS value,
                 SUM(CASE WHEN ev."kind"::text = 'DISCOUNT_ATTEMPTED' THEN 1 ELSE 0 END)::bigint AS attempted,
                 SUM(CASE WHEN ev."kind"::text = 'DISCOUNT_APPLIED' THEN 1 ELSE 0 END)::bigint AS applied,
                 SUM(CASE WHEN ev."kind"::text = 'DISCOUNT_REJECTED' THEN 1 ELSE 0 END)::bigint AS rejected
          FROM "VisitorEvent" ev
          INNER JOIN "VisitorSession" s ON s."id" = ev."sessionId"
          WHERE ${rawFilter}
            AND ev."kind"::text IN ('DISCOUNT_ATTEMPTED','DISCOUNT_APPLIED','DISCOUNT_REJECTED')
            AND ev."value" IS NOT NULL
          GROUP BY ev."value"
          ORDER BY attempted DESC
          LIMIT 15
        `),
        // Engagement signal counts — exit intent, rage click, dead click.
        ctx.prisma.$queryRaw<Array<{ kind: string; count: bigint }>>(Prisma.sql`
          SELECT ev."kind"::text AS kind, COUNT(*)::bigint AS count
          FROM "VisitorEvent" ev
          INNER JOIN "VisitorSession" s ON s."id" = ev."sessionId"
          WHERE ${rawFilter}
            AND ev."kind"::text IN ('EXIT_INTENT','RAGE_CLICK','DEAD_CLICK')
          GROUP BY ev."kind"
        `),
        // Scroll-depth distribution: sessions that reached each bucket.
        // COUNT(DISTINCT sessionId) so a session reaching 75 is credited
        // to 25/50/75 buckets without double-counting within a bucket.
        ctx.prisma.$queryRaw<Array<{ depth: number; sessions: bigint }>>(Prisma.sql`
          SELECT ev."numericValue"::int AS depth,
                 COUNT(DISTINCT ev."sessionId")::bigint AS sessions
          FROM "VisitorEvent" ev
          INNER JOIN "VisitorSession" s ON s."id" = ev."sessionId"
          WHERE ${rawFilter}
            AND ev."kind"::text = 'SCROLL_DEPTH'
            AND ev."numericValue" IN (25, 50, 75, 100)
          GROUP BY ev."numericValue"
          ORDER BY depth
        `),
        // Engagement score aggregate — average + percentile-esque view.
        ctx.prisma.visitorSession.aggregate({
          where: { ...where, engagementScore: { not: null } },
          _avg: { engagementScore: true },
          _count: { engagementScore: true },
        }),
      ]);

      // Hydrate vehicle labels for fleet click/view targets that look
      // like cuids. Silently falls back to the raw target otherwise —
      // some targets are category slugs or fleet-card indexes.
      const vehicleTargets = Array.from(
        new Set(
          [...topFleetClickRows, ...topFleetViewRows]
            .map((r) => r.target)
            .filter((t): t is string => typeof t === "string" && /^c[a-z0-9]{20,}$/.test(t)),
        ),
      );
      const vehicleLabelMap = new Map<string, string>();
      if (vehicleTargets.length) {
        const vehicles = await ctx.prisma.vehicle.findMany({
          where: { id: { in: vehicleTargets } },
          select: { id: true, make: true, model: true, internalCode: true, rego: true },
        });
        for (const v of vehicles) {
          vehicleLabelMap.set(
            v.id,
            `${v.make ?? ""} ${v.model ?? ""}`.trim() || v.internalCode || v.rego || v.id,
          );
        }
      }
      const labelForVehicleTarget = (t: string) => vehicleLabelMap.get(t) ?? t;

      const dowHourMatrix: Array<{ dow: number; hour: number; count: number }> = [];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const row = dowHourRows.find((r) => r.dow === d && r.hour === h);
          dowHourMatrix.push({ dow: d, hour: h, count: row ? Number(row.count) : 0 });
        }
      }

      // Bucket page-depth into: 1, 2, 3-5, 6-10, 11+
      const depthBuckets: Record<string, number> = { "1": 0, "2": 0, "3-5": 0, "6-10": 0, "11+": 0 };
      for (const g of pageDepthGroups) {
        const v = g.totalPageViews;
        const key = v <= 1 ? "1" : v === 2 ? "2" : v <= 5 ? "3-5" : v <= 10 ? "6-10" : "11+";
        depthBuckets[key] = (depthBuckets[key] ?? 0) + g._count._all;
      }
      const pageDepth = Object.entries(depthBuckets).map(([bucket, count]) => ({ bucket, count }));

      return {
        totalSessions,
        dowHourMatrix,
        topPages: topPages.map((r) => ({
          path: r.path,
          views: Number(r.views),
          avgMs: r.avg_ms == null ? null : Math.round(r.avg_ms),
        })),
        pageDepth,
        topCtas: topCtaRows.map((r) => ({ target: r.target, count: Number(r.count) })),
        topFleetClicks: topFleetClickRows.map((r) => ({
          target: r.target,
          label: labelForVehicleTarget(r.target),
          count: Number(r.count),
        })),
        topFleetViews: topFleetViewRows.map((r) => ({
          target: r.target,
          label: labelForVehicleTarget(r.target),
          count: Number(r.count),
        })),
        topSearches: topSearchRows.map((r) => ({ query: r.value, count: Number(r.count) })),
        discountFunnel: discountFunnelRows.map((r) => ({
          code: r.value,
          attempted: Number(r.attempted),
          applied: Number(r.applied),
          rejected: Number(r.rejected),
        })),
        engagementSignals: engagementSignalRows.reduce<Record<string, number>>((acc, r) => {
          acc[r.kind] = Number(r.count);
          return acc;
        }, { EXIT_INTENT: 0, RAGE_CLICK: 0, DEAD_CLICK: 0 }),
        scrollDepth: [25, 50, 75, 100].map((depth) => {
          const row = scrollDepthRows.find((r) => Number(r.depth) === depth);
          return { depth, sessions: row ? Number(row.sessions) : 0 };
        }),
        engagementScore: {
          average: engagementScoreAgg._avg.engagementScore
            ? Math.round(engagementScoreAgg._avg.engagementScore)
            : null,
          sampleSize: engagementScoreAgg._count.engagementScore ?? 0,
        },
      };
    }),

  /**
   * Conversion-tab aggregates: funnel with reached + drop-off %,
   * outcome split for the stacked bar, and the distribution of
   * abandoned sessions by the step at which they bailed.
   */
  conversion: staffProcedure
    .input(ANALYTICS_FILTER)
    .query(async ({ ctx, input }) => {
      const current = rangeBounds(input.range);
      const { where } = buildSessionWhere(current, input);
      const abandonedWhere: Prisma.VisitorSessionWhereInput = {
        ...where,
        outcome: "ABANDONED_WIZARD",
      };

      const [
        totalSessions,
        funnelGroups,
        outcomeGroups,
        abandonedByStepGroups,
        abandonedDepotGroups,
        abandonedCategoryGroups,
        abandonedVehicleGroups,
        abandonedDiscountGroups,
        abandonedQuoteAgg,
      ] = await Promise.all([
        ctx.prisma.visitorSession.count({ where }),
        ctx.prisma.visitorSession.groupBy({
          by: ["wizardHighestStep"],
          where,
          _count: { _all: true },
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["outcome"],
          where: { ...where, outcome: { not: null } },
          _count: { _all: true },
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["wizardHighestStep"],
          where: abandonedWhere,
          _count: { _all: true },
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["pickupDepotId"],
          where: { ...abandonedWhere, pickupDepotId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { pickupDepotId: "desc" } },
          take: 10,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["categoryId"],
          where: { ...abandonedWhere, categoryId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { categoryId: "desc" } },
          take: 10,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["vehicleId"],
          where: { ...abandonedWhere, vehicleId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { vehicleId: "desc" } },
          take: 10,
        }),
        ctx.prisma.visitorSession.groupBy({
          by: ["discountCode"],
          where: { ...abandonedWhere, discountCode: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { discountCode: "desc" } },
          take: 10,
        }),
        ctx.prisma.visitorSession.aggregate({
          where: { ...abandonedWhere, quotedTotalCents: { not: null } },
          _sum: { quotedTotalCents: true },
          _count: { quotedTotalCents: true },
        }),
      ]);

      // Hydrate the labels for depot/category/vehicle ids so we don't
      // surface opaque cuids in the UI. One round trip per type is
      // fine — each returns at most 10 rows.
      const [depots, categories, vehicles] = await Promise.all([
        abandonedDepotGroups.length
          ? ctx.prisma.depot.findMany({
              where: { id: { in: abandonedDepotGroups.map((g) => g.pickupDepotId!).filter(Boolean) } },
              select: { id: true, name: true, suburb: true },
            })
          : Promise.resolve([]),
        abandonedCategoryGroups.length
          ? ctx.prisma.vehicleCategory.findMany({
              where: { id: { in: abandonedCategoryGroups.map((g) => g.categoryId!).filter(Boolean) } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        abandonedVehicleGroups.length
          ? ctx.prisma.vehicle.findMany({
              where: { id: { in: abandonedVehicleGroups.map((g) => g.vehicleId!).filter(Boolean) } },
              select: { id: true, internalCode: true, rego: true, make: true, model: true },
            })
          : Promise.resolve([]),
      ]);
      const depotMap = new Map(depots.map((d) => [d.id, d]));
      const categoryMap = new Map(categories.map((c) => [c.id, c]));
      const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

      const stepCounts: Record<number, number> = {};
      let noWizard = 0;
      for (const g of funnelGroups) {
        if (g.wizardHighestStep == null) noWizard += g._count._all;
        else stepCounts[g.wizardHighestStep] = (stepCounts[g.wizardHighestStep] ?? 0) + g._count._all;
      }
      const funnel: Array<{ step: number; reached: number; dropOffRate: number | null; droppedAtStep: number }> = [];
      for (let step = 1; step <= 6; step++) {
        let reached = 0;
        for (const [k, v] of Object.entries(stepCounts)) {
          if (Number(k) >= step) reached += v;
        }
        const prev = funnel[funnel.length - 1];
        const dropOffRate =
          prev && prev.reached > 0 ? Math.max(0, 1 - reached / prev.reached) : null;
        const droppedAtStep = stepCounts[step] ?? 0;
        funnel.push({ step, reached, dropOffRate, droppedAtStep });
      }

      return {
        totalSessions,
        funnel,
        outcome: outcomeGroups.map((g) => ({ outcome: g.outcome, count: g._count._all })),
        abandonedByStep: abandonedByStepGroups
          .filter((g) => g.wizardHighestStep != null)
          .map((g) => ({ step: g.wizardHighestStep as number, count: g._count._all })),
        noWizardVisitors: noWizard,
        abandonedCart: {
          depots: abandonedDepotGroups.map((g) => {
            const d = g.pickupDepotId ? depotMap.get(g.pickupDepotId) : null;
            return {
              id: g.pickupDepotId,
              label: d ? `${d.name}${d.suburb ? ` · ${d.suburb}` : ""}` : g.pickupDepotId ?? "Unknown",
              count: g._count._all,
            };
          }),
          categories: abandonedCategoryGroups.map((g) => {
            const c = g.categoryId ? categoryMap.get(g.categoryId) : null;
            return {
              id: g.categoryId,
              label: c?.name ?? g.categoryId ?? "Unknown",
              count: g._count._all,
            };
          }),
          vehicles: abandonedVehicleGroups.map((g) => {
            const v = g.vehicleId ? vehicleMap.get(g.vehicleId) : null;
            const label = v
              ? `${v.make ?? ""} ${v.model ?? ""}`.trim() || v.internalCode || v.rego || g.vehicleId || "Unknown"
              : g.vehicleId ?? "Unknown";
            return { id: g.vehicleId, label, count: g._count._all };
          }),
          discountCodes: abandonedDiscountGroups.map((g) => ({
            code: g.discountCode,
            count: g._count._all,
          })),
          revenueAtRiskCents: abandonedQuoteAgg._sum.quotedTotalCents ?? 0,
          revenueAtRiskSampleSize: abandonedQuoteAgg._count.quotedTotalCents ?? 0,
        },
      };
    }),

  /**
   * Retention-tab aggregates. Uses the `visitorFingerprint` +
   * `sessionNumber` columns stamped at session-create time (Slice 2):
   *   - new-vs-returning: split by `isReturning`
   *   - session-number cohort: conversion rate for session 1 / 2 / 3+
   *   - days-to-convert: distribution of (convertedAt - firstSessionAt)
   *     in days, bucketed for the histogram
   *   - registered-vs-guest: retained from the placeholder
   */
  retention: staffProcedure
    .input(ANALYTICS_FILTER)
    .query(async ({ ctx, input }) => {
      const current = rangeBounds(input.range);
      const { where } = buildSessionWhere(current, input);

      const [
        registered,
        guest,
        newVisitors,
        returningVisitors,
        cohortGroups,
        daysToConvertRows,
      ] = await Promise.all([
        ctx.prisma.visitorSession.count({ where: { ...where, userId: { not: null } } }),
        ctx.prisma.visitorSession.count({ where: { ...where, userId: null } }),
        ctx.prisma.visitorSession.count({ where: { ...where, isReturning: false } }),
        ctx.prisma.visitorSession.count({ where: { ...where, isReturning: true } }),
        // Group by sessionNumber, and for each cohort count converted
        // sessions so the UI can surface conversion rate per cohort.
        ctx.prisma.$queryRaw<
          Array<{ cohort: number; sessions: bigint; converted: bigint }>
        >(Prisma.sql`
          SELECT
            LEAST("sessionNumber", 5)::int AS cohort,
            COUNT(*)::bigint AS sessions,
            SUM(CASE WHEN "outcome"::text = 'CONVERTED' THEN 1 ELSE 0 END)::bigint AS converted
          FROM "VisitorSession"
          WHERE ${buildRawFilterSql(current, input)}
          GROUP BY 1
          ORDER BY 1
        `),
        // Days from the visitor's first seen-at (min startedAt per
        // fingerprint) to conversion. Rows with no fingerprint are
        // excluded — we only want repeat-visitor conversions here.
        ctx.prisma.$queryRaw<Array<{ days: number; count: bigint }>>(Prisma.sql`
          WITH first_seen AS (
            SELECT "visitorFingerprint" AS fp, MIN("startedAt") AS first_at
            FROM "VisitorSession"
            WHERE "visitorFingerprint" IS NOT NULL
            GROUP BY "visitorFingerprint"
          )
          SELECT
            FLOOR(EXTRACT(EPOCH FROM (s."startedAt" - fs.first_at)) / 86400)::int AS days,
            COUNT(*)::bigint AS count
          FROM "VisitorSession" s
          JOIN first_seen fs ON fs.fp = s."visitorFingerprint"
          WHERE ${buildRawFilterSql(current, input)}
            AND s."outcome"::text = 'CONVERTED'
          GROUP BY 1
          ORDER BY 1
        `),
      ]);

      const totalSessions = registered + guest;
      const cohorts = cohortGroups.map((g) => ({
        cohort: Number(g.cohort),
        // Label the bucketed tail: cohort 5 covers "session 5+" because
        // we LEAST()-clamped at 5.
        label: Number(g.cohort) >= 5 ? "Session 5+" : `Session ${Number(g.cohort)}`,
        sessions: Number(g.sessions),
        converted: Number(g.converted),
        conversionRate: Number(g.sessions) > 0 ? Number(g.converted) / Number(g.sessions) : 0,
      }));

      // Bucket days-to-convert into: same-day, 1d, 2–3d, 4–7d, 8–30d, 30+d.
      const daysBuckets: Record<string, number> = {
        "Same day": 0,
        "1 day": 0,
        "2–3 days": 0,
        "4–7 days": 0,
        "8–30 days": 0,
        "30+ days": 0,
      };
      let totalConverted = 0;
      for (const r of daysToConvertRows) {
        const d = Number(r.days);
        const c = Number(r.count);
        totalConverted += c;
        const key =
          d <= 0 ? "Same day" : d === 1 ? "1 day" : d <= 3 ? "2–3 days" : d <= 7 ? "4–7 days" : d <= 30 ? "8–30 days" : "30+ days";
        daysBuckets[key] = (daysBuckets[key] ?? 0) + c;
      }
      const daysToConvert = Object.entries(daysBuckets).map(([bucket, count]) => ({
        bucket,
        count,
      }));

      return {
        totalSessions,
        registered,
        guest,
        newVisitors,
        returningVisitors,
        cohorts,
        daysToConvert,
        daysToConvertTotal: totalConverted,
      };
    }),

  /**
   * Paginated session list for the Sessions tab. Extended with all the
   * drill-down filters exposed by the summary procedures so a click on
   * any aggregate widget opens this list pre-filtered via URL params.
   */
  sessionsList: staffProcedure
    .input(
      ANALYTICS_FILTER.partial()
        .omit({ compare: true })
        .extend({
          from: z.date().optional(),
          to: z.date().optional(),
          outcome: z.enum(["BOUNCED", "ABANDONED_WIZARD", "CONVERTED", "LEFT"]).optional(),
          staffInteracted: z.boolean().optional(),
          page: z.number().min(1).default(1),
          pageSize: z.number().min(10).max(100).default(25),
        }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.VisitorSessionWhereInput = {
        ...(input.from || input.to
          ? { startedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
          : {}),
        ...(input.outcome ? { outcome: input.outcome } : {}),
        ...(input.country ? { country: input.country } : {}),
        ...(input.landingPath ? { landingPath: input.landingPath } : {}),
        ...(input.utmSource ? { utmSource: input.utmSource } : {}),
        ...(input.utmMedium ? { utmMedium: input.utmMedium } : {}),
        ...(input.utmCampaign ? { utmCampaign: input.utmCampaign } : {}),
        ...(input.referrerDomain ? { referrer: input.referrerDomain } : {}),
        ...(input.wizardStepEq != null ? { wizardHighestStep: input.wizardStepEq } : {}),
        ...(input.pickupDepotId ? { pickupDepotId: input.pickupDepotId } : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
        ...(input.discountCode ? { discountCode: input.discountCode } : {}),
        ...(input.segment ? segmentWhere(input.segment) : {}),
        ...(input.staffInteracted === true ? { conversationId: { not: null } } : {}),
        ...(input.staffInteracted === false ? { conversationId: null } : {}),
      };
      // For hour/dow filters we post-filter with a raw EXISTS clause, since
      // Prisma can't express DATE_PART in its where language.
      if (input.hour != null || input.dow != null) {
        const parts: Prisma.Sql[] = [];
        if (input.hour != null) parts.push(Prisma.sql`EXTRACT(HOUR FROM "startedAt") = ${input.hour}`);
        if (input.dow != null) parts.push(Prisma.sql`EXTRACT(DOW FROM "startedAt") = ${input.dow}`);
        const idRows = await ctx.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "VisitorSession" WHERE ${Prisma.join(parts, " AND ")}
        `);
        where.id = { in: idRows.map((r) => r.id) };
      }
      const [items, totalCount] = await Promise.all([
        ctx.prisma.visitorSession.findMany({
          where,
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
            convertedBooking: { select: { id: true, bookingReference: true, totalAmount: true } },
            conversation: { select: { id: true, _count: { select: { messages: true } } } },
          },
          orderBy: { startedAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.visitorSession.count({ where }),
      ]);
      return {
        items: items.map((s) => ({
          ...s,
          convertedBooking: s.convertedBooking
            ? { ...s.convertedBooking, totalAmount: s.convertedBooking.totalAmount.toNumber() }
            : null,
        })),
        totalCount,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(totalCount / input.pageSize)),
      };
    }),

  /**
   * Full detail for a single session — used by the detail drawer in the
   * Sessions tab. Returns page-view timeline + chat transcript.
   */
  sessionDetail: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const s = await ctx.prisma.visitorSession.findUnique({
        where: { id: input.id },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          convertedBooking: { select: { id: true, bookingReference: true, totalAmount: true } },
          pageViews: { orderBy: { enteredAt: "asc" } },
          events: { orderBy: { occurredAt: "asc" }, take: 500 },
          conversation: {
            include: {
              messages: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      });
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });

      // Hydrate labels for the wizard-cart columns so the detail drawer
      // renders human-readable names instead of cuids. All three queries
      // are single-row lookups and only fire when the column is set.
      const [depot, category, vehicle] = await Promise.all([
        s.pickupDepotId
          ? ctx.prisma.depot.findUnique({
              where: { id: s.pickupDepotId },
              select: { id: true, name: true, suburb: true },
            })
          : Promise.resolve(null),
        s.categoryId
          ? ctx.prisma.vehicleCategory.findUnique({
              where: { id: s.categoryId },
              select: { id: true, name: true },
            })
          : Promise.resolve(null),
        s.vehicleId
          ? ctx.prisma.vehicle.findUnique({
              where: { id: s.vehicleId },
              select: { id: true, internalCode: true, rego: true, make: true, model: true },
            })
          : Promise.resolve(null),
      ]);
      const cart = s.pickupDepotId || s.categoryId || s.vehicleId || s.discountCode
        ? {
            depotLabel: depot ? `${depot.name}${depot.suburb ? ` · ${depot.suburb}` : ""}` : null,
            categoryLabel: category?.name ?? null,
            vehicleLabel: vehicle
              ? `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() ||
                vehicle.internalCode ||
                vehicle.rego ||
                null
              : null,
            discountCode: s.discountCode,
            quotedTotalCents: s.quotedTotalCents,
          }
        : null;

      return {
        ...s,
        convertedBooking: s.convertedBooking
          ? { ...s.convertedBooking, totalAmount: s.convertedBooking.totalAmount.toNumber() }
          : null,
        cart,
      };
    }),

  /**
   * Staff-to-visitor interaction list. Reads `SupportConversation` rows
   * from the LIVE_VIEW source (populated by `live.startChatWithVisitor`
   * and `visitorOpenChat`) with message counts and attribution.
   */
  interactionsList: staffProcedure
    .input(
      z.object({
        from: z.date().optional(),
        to: z.date().optional(),
        staffId: z.string().optional(),
        outcome: z.enum(["CONVERTED", "NO_RESPONSE", "ABANDONED", "IN_PROGRESS", "RESOLVED"]).optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(10).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.SupportConversationWhereInput = {
        source: "LIVE_VIEW",
        ...(input.from || input.to
          ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
          : {}),
        ...(input.outcome ? { interactionOutcome: input.outcome } : {}),
        ...(input.staffId
          ? { messages: { some: { senderRole: "STAFF", senderUserId: input.staffId } } }
          : {}),
      };
      const [items, totalCount] = await Promise.all([
        ctx.prisma.supportConversation.findMany({
          where,
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, email: true } },
            attributedBooking: { select: { id: true, bookingReference: true, totalAmount: true } },
            visitor: { select: { id: true, country: true, landingPath: true } },
            _count: { select: { messages: true } },
            messages: {
              where: { senderRole: "STAFF" },
              select: { senderUserId: true },
              take: 1,
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.supportConversation.count({ where }),
      ]);
      const staffIds = Array.from(
        new Set(items.flatMap((i) => i.messages.map((m) => m.senderUserId)).filter((x): x is string => !!x)),
      );
      const staff = staffIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const staffMap = new Map(staff.map((s) => [s.id, s]));
      return {
        items: items.map((c) => ({
          ...c,
          firstStaffUserId: c.messages[0]?.senderUserId ?? null,
          firstStaff: c.messages[0]?.senderUserId ? staffMap.get(c.messages[0].senderUserId) ?? null : null,
          messageCount: c._count.messages,
          attributedBooking: c.attributedBooking
            ? { ...c.attributedBooking, totalAmount: c.attributedBooking.totalAmount.toNumber() }
            : null,
        })),
        totalCount,
        page: input.page,
        pageSize: input.pageSize,
        pageCount: Math.max(1, Math.ceil(totalCount / input.pageSize)),
      };
    }),

  /**
   * Per-staff sales performance leaderboard. For each staff member who
   * sent at least one LIVE_VIEW message in the range, aggregates:
   * interactions, avg first-response (seconds), conversion %, revenue
   * attributed (AUD).
   */
  salesPerformance: staffProcedure
    .input(
      z.object({
        from: z.date().optional(),
        to: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const dateFilter: Prisma.SupportConversationWhereInput = input.from || input.to
        ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
        : {};
      const convs = await ctx.prisma.supportConversation.findMany({
        where: {
          source: "LIVE_VIEW",
          ...dateFilter,
          messages: { some: { senderRole: "STAFF" } },
        },
        select: {
          id: true,
          firstResponseSeconds: true,
          interactionOutcome: true,
          attributedBooking: { select: { totalAmount: true } },
          messages: {
            where: { senderRole: "STAFF" },
            select: { senderUserId: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      });
      const byStaff = new Map<
        string,
        {
          interactions: number;
          responseSecondsSum: number;
          responseCount: number;
          converted: number;
          revenueCents: number;
        }
      >();
      for (const c of convs) {
        const staffId = c.messages[0]?.senderUserId;
        if (!staffId) continue;
        const row = byStaff.get(staffId) ?? {
          interactions: 0,
          responseSecondsSum: 0,
          responseCount: 0,
          converted: 0,
          revenueCents: 0,
        };
        row.interactions++;
        if (c.firstResponseSeconds != null) {
          row.responseSecondsSum += c.firstResponseSeconds;
          row.responseCount++;
        }
        if (c.interactionOutcome === "CONVERTED") row.converted++;
        if (c.attributedBooking) {
          row.revenueCents += Math.round(c.attributedBooking.totalAmount.toNumber() * 100);
        }
        byStaff.set(staffId, row);
      }
      const staffIds = Array.from(byStaff.keys());
      const staff = staffIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [];
      const rows = staff
        .map((s) => {
          const agg = byStaff.get(s.id)!;
          return {
            staffId: s.id,
            firstName: s.firstName,
            lastName: s.lastName,
            email: s.email,
            interactions: agg.interactions,
            avgResponseSeconds:
              agg.responseCount > 0 ? Math.round(agg.responseSecondsSum / agg.responseCount) : null,
            conversionRate: agg.interactions > 0 ? agg.converted / agg.interactions : 0,
            revenueAud: agg.revenueCents / 100,
          };
        })
        .sort((a, b) => b.revenueAud - a.revenueAud);
      return { rows };
    }),
});
