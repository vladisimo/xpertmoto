/**
 * AUD cost calculation + persistence for document-extract (licence /
 * passport OCR) vision calls.
 *
 * Mirrors src/server/services/support-cost.ts. The OCR path runs Claude
 * Sonnet 4.6 (or the openrouter mirror). When OpenRouter returns an
 * `upstreamCostUsd`, we prefer it × USD_AUD_RATE so we stay aligned with
 * their billing; otherwise we compute from tokens × per-1M rate constants.
 */

import type { PrismaClient } from "@prisma/client";
import { CLAUDE_SONNET_4_6_PRICING_AUD, USD_AUD_RATE } from "@/lib/constants";
import { logger } from "@/lib/logger";

export interface OcrUsage {
  provider: "anthropic" | "openrouter";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  /** Optional — OpenRouter exposes the upstream USD cost for an exact match. */
  upstreamCostUsd?: number;
  /** Wall-clock latency of the vision call, set by document-extract. */
  latencyMs?: number;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function ocrUsageToAud(usage: OcrUsage): number {
  if (usage.provider === "openrouter" && typeof usage.upstreamCostUsd === "number") {
    return round6(usage.upstreamCostUsd * USD_AUD_RATE);
  }
  const rate = CLAUDE_SONNET_4_6_PRICING_AUD;
  const perMillion = 1_000_000;
  const cost =
    (usage.inputTokens * rate.input) / perMillion +
    (usage.outputTokens * rate.output) / perMillion +
    (usage.cachedInputTokens * rate.cacheRead) / perMillion +
    (usage.cacheCreationTokens * rate.cacheWrite) / perMillion;
  return round6(cost);
}

export type OcrLogContext = {
  prisma: PrismaClient;
  kind: "LICENCE" | "PASSPORT" | "INFRINGEMENT" | "OTHER";
  customerId?: string;
  bookingId?: string;
  triggeredById?: string;
  outcome?: "SUCCESS" | "LOW_CONFIDENCE" | "NO_MATCH" | "ERROR";
};

/**
 * Fire-and-forget write of an OcrCostLog row. Failures are logged but never
 * thrown — cost tracking must not break the user-visible OCR flow.
 */
export async function recordOcrUsage(
  ctx: OcrLogContext,
  usage: OcrUsage,
): Promise<number> {
  const costAud = ocrUsageToAud(usage);
  try {
    await ctx.prisma.ocrCostLog.create({
      data: {
        kind: ctx.kind,
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        costAud,
        ...(ctx.customerId ? { customerId: ctx.customerId } : {}),
        ...(ctx.bookingId ? { bookingId: ctx.bookingId } : {}),
        ...(ctx.triggeredById ? { triggeredById: ctx.triggeredById } : {}),
        ...(ctx.outcome ? { outcome: ctx.outcome } : {}),
      },
    });
  } catch (e) {
    logger.warn({ err: e }, "recordOcrUsage: write failed");
  }
  return costAud;
}
