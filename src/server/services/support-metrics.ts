/**
 * Admin metrics aggregates for the support inbox. Kept separate from the
 * tRPC router so unit tests can drive Prisma directly without wiring
 * auth.
 */

import type { PrismaClient, SupportCategory } from "@prisma/client";

export type SupportMetricsInput = {
  from: Date;
  to: Date;
  depotId?: string;
  category?: SupportCategory;
};

export type SupportMetrics = {
  ticketsOpened: number;
  ticketsResolved: number;
  ticketsClosed: number;
  conversationsStarted: number;
  /** Conversations that never produced a ticket (AI deflected). */
  aiDeflectedConversations: number;
  aiDeflectionRate: number; // 0..1
  csat: { avg: number; count: number; distribution: Record<number, number> };
  aiHelpfulRate: number; // 0..1
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  /** AUD across the window. */
  llmCostAud: number;
  /** Today vs rolling 24h for the cap banner. */
  llmCostAudLast24h: number;
};

export async function computeSupportMetrics(
  prisma: PrismaClient,
  input: SupportMetricsInput,
): Promise<SupportMetrics> {
  const { from, to } = input;
  const ticketWhere = {
    createdAt: { gte: from, lte: to },
    ...(input.depotId ? { depotId: input.depotId } : {}),
    ...(input.category ? { category: input.category } : {}),
  };

  const [
    ticketsOpened,
    ticketsResolved,
    ticketsClosed,
    conversationsStarted,
    conversationsWithTickets,
    feedback,
    firstResponse,
    resolved,
    llmAgg,
    llm24hAgg,
  ] = await Promise.all([
    prisma.supportTicket.count({ where: ticketWhere }),
    prisma.supportTicket.count({
      where: { ...ticketWhere, resolvedAt: { not: null } },
    }),
    prisma.supportTicket.count({
      where: { ...ticketWhere, closedAt: { not: null } },
    }),
    prisma.supportConversation.count({
      where: {
        createdAt: { gte: from, lte: to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
    }),
    prisma.supportConversation.count({
      where: {
        createdAt: { gte: from, lte: to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
        ticket: { isNot: null },
      },
    }),
    prisma.supportFeedback.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      select: { rating: true, kind: true },
    }),
    prisma.supportTicket.findMany({
      where: { ...ticketWhere, firstResponseAt: { not: null } },
      select: { createdAt: true, firstResponseAt: true },
    }),
    prisma.supportTicket.findMany({
      where: { ...ticketWhere, resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
    }),
    prisma.supportCostLog.aggregate({
      where: { createdAt: { gte: from, lte: to } },
      _sum: { costAud: true },
    }),
    prisma.supportCostLog.aggregate({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      _sum: { costAud: true },
    }),
  ]);

  const aiDeflected = conversationsStarted - conversationsWithTickets;
  const aiDeflectionRate =
    conversationsStarted > 0 ? aiDeflected / conversationsStarted : 0;

  const csatRows = feedback.filter((f) => f.kind === "CSAT");
  const csatCount = csatRows.length;
  const csatSum = csatRows.reduce((acc, r) => acc + r.rating, 0);
  const csatAvg = csatCount > 0 ? csatSum / csatCount : 0;
  const csatDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of csatRows) {
    if (r.rating >= 1 && r.rating <= 5) csatDist[r.rating] = (csatDist[r.rating] ?? 0) + 1;
  }

  const helpful = feedback.filter((f) => f.kind === "AI_HELPFUL").length;
  const notHelpful = feedback.filter((f) => f.kind === "AI_NOT_HELPFUL").length;
  const aiHelpfulRate = helpful + notHelpful > 0 ? helpful / (helpful + notHelpful) : 0;

  const avgFirstResponseMinutes =
    firstResponse.length === 0
      ? null
      : Math.round(
          firstResponse.reduce(
            (sum, t) => sum + (t.firstResponseAt!.getTime() - t.createdAt.getTime()),
            0,
          ) /
            firstResponse.length /
            60000,
        );
  const avgResolutionMinutes =
    resolved.length === 0
      ? null
      : Math.round(
          resolved.reduce(
            (sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()),
            0,
          ) /
            resolved.length /
            60000,
        );

  return {
    ticketsOpened,
    ticketsResolved,
    ticketsClosed,
    conversationsStarted,
    aiDeflectedConversations: aiDeflected,
    aiDeflectionRate,
    csat: { avg: csatAvg, count: csatCount, distribution: csatDist },
    aiHelpfulRate,
    avgFirstResponseMinutes,
    avgResolutionMinutes,
    llmCostAud: Number(llmAgg._sum.costAud ?? 0),
    llmCostAudLast24h: Number(llm24hAgg._sum.costAud ?? 0),
  };
}
