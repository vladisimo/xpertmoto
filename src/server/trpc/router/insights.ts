import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, managerProcedure } from "../trpc";
import { rateLimit } from "@/lib/rate-limit";
import {
  generateInsightsOverview,
  generatePayload,
} from "@/server/services/insights/orchestrator";
import {
  invalidateOverviewCache,
  readOverviewCache,
  writeOverviewCache,
} from "@/server/services/insights/cache";
import { InsightsDataInsufficientError } from "@/server/services/insights/readiness";
import {
  INSIGHT_IDS,
  INSIGHT_META,
  type InsightId,
} from "@/server/services/insights/types";

const depotScopeInput = z
  .object({ depotId: z.string().optional() })
  .optional();

const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

export const insightsRouter = createTRPCRouter({
  overview: managerProcedure.input(depotScopeInput).query(async ({ ctx, input }) => {
    const depotId = resolveDepot(ctx, input);
    const cached = await readOverviewCache(depotId);
    if (cached && cached.readiness?.sufficient) {
      const age = Date.now() - Date.parse(cached.generatedAt);
      cached.stale = age > STALE_AFTER_MS;
      return cached;
    }

    const scopeLabel = await resolveScopeLabel(ctx, depotId);
    const overview = await generateInsightsOverview(ctx.prisma, depotId, scopeLabel);
    if (overview.readiness.sufficient) {
      await writeOverviewCache(overview, depotId);
    } else {
      await invalidateOverviewCache(depotId);
    }
    return overview;
  }),

  refresh: managerProcedure.input(depotScopeInput).mutation(async ({ ctx, input }) => {
    const depotId = resolveDepot(ctx, input);
    const gate = await rateLimit(`insights:refresh:${ctx.user.id}`, 1, 5 * 60);
    if (!gate.ok) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Insights can only be refreshed once every five minutes.",
      });
    }

    await invalidateOverviewCache(depotId);
    const scopeLabel = await resolveScopeLabel(ctx, depotId);
    const overview = await generateInsightsOverview(ctx.prisma, depotId, scopeLabel);
    if (overview.readiness.sufficient) {
      await writeOverviewCache(overview, depotId);
    }
    return overview;
  }),

  detail: managerProcedure
    .input(
      z.object({
        id: z.enum([...INSIGHT_IDS] as [InsightId, ...InsightId[]]),
        depotId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const depotId = resolveDepot(ctx, { depotId: input.depotId });
      try {
        const payload = await generatePayload(ctx.prisma, input.id, depotId);
        const meta = INSIGHT_META[input.id];
        return {
          id: input.id,
          pillar: meta.pillar,
          title: meta.title,
          payload,
          scopeLabel: await resolveScopeLabel(ctx, depotId),
        };
      } catch (err) {
        if (err instanceof InsightsDataInsufficientError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Not enough data to compute this insight yet.",
            cause: err,
          });
        }
        throw err;
      }
    }),
});

type InsightsCtx = {
  user: { role: string; depotId: string | null };
  prisma: import("@prisma/client").PrismaClient;
};

function resolveDepot(
  ctx: InsightsCtx,
  input: { depotId?: string } | undefined,
): string | undefined {
  if (ctx.user.role === "MANAGER") {
    return ctx.user.depotId ?? undefined;
  }
  return input?.depotId;
}

async function resolveScopeLabel(
  ctx: InsightsCtx,
  depotId: string | undefined,
): Promise<string> {
  if (!depotId) return "All depots";
  const depot = await ctx.prisma.depot.findUnique({
    where: { id: depotId },
    select: { name: true },
  });
  return depot?.name ?? "Depot";
}
