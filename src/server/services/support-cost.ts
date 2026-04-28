/**
 * AUD cost calculation + persistence for AI stream usage events.
 *
 * Anthropic (direct): compute from tokens × AUD-per-1M rate constants.
 * OpenRouter: prefer the upstream `cost` (USD) × USD_AUD_RATE so we
 * stay aligned with their billing even if our per-token rates drift.
 *
 * The daily cap guard reads SupportCostLog rows and sums `costAud` over
 * the rolling 24h window.
 */

import type { PrismaClient } from "@prisma/client";
import { CLAUDE_HAIKU_4_5_PRICING_AUD, USD_AUD_RATE } from "@/lib/constants";
import type { SupportAIUsage } from "./support-ai";

export function usageToAud(usage: SupportAIUsage): number {
  if (usage.provider === "openrouter" && typeof usage.upstreamCostUsd === "number") {
    return round6(usage.upstreamCostUsd * USD_AUD_RATE);
  }
  const rate = CLAUDE_HAIKU_4_5_PRICING_AUD;
  const perMillion = 1_000_000;
  const cost =
    (usage.inputTokens * rate.input) / perMillion +
    (usage.outputTokens * rate.output) / perMillion +
    (usage.cachedInputTokens * rate.cacheRead) / perMillion +
    (usage.cacheCreationTokens * rate.cacheWrite) / perMillion;
  return round6(cost);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function recordUsage(
  prisma: PrismaClient,
  conversationId: string,
  usage: SupportAIUsage,
): Promise<number> {
  const costAud = usageToAud(usage);
  await prisma.supportCostLog.create({
    data: {
      conversationId,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costAud,
    },
  });
  return costAud;
}

/**
 * Sum SupportCostLog AUD over the last 24h. Returns 0 if nothing spent.
 */
export async function rollingDailyCostAud(prisma: PrismaClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const agg = await prisma.supportCostLog.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { costAud: true },
  });
  return Number(agg._sum.costAud ?? 0);
}
