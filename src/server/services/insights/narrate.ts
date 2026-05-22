/**
 * Turns a deterministic InsightPayload into an InsightNarrative (headline,
 * summary, recommendation, priority, confidence) via a single Claude Haiku
 * tool-use call. Numbers are not invented by the model — the AI can only
 * reference values in the payload, and the schema constrains the output
 * shape. If the provider is unavailable or returns malformed output, we
 * fall back to a deterministic narrative derived from the payload.
 */

import { z } from "zod";
import { getSupportConfig } from "@/lib/support-config";
import {
  getSupportAIProvider,
  SupportAIUnavailableError,
  type SupportAIMessage,
  type SupportAITool,
} from "./../support-ai";
import { logger } from "@/lib/logger";
import {
  INSIGHT_META,
  type InsightNarrative,
  type InsightPayload,
  type InsightPriority,
} from "./types";

const narrativeSchema = z.object({
  headline: z.string().min(4).max(140),
  summary: z.string().min(10).max(400),
  recommendation: z.string().min(10).max(400),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  confidence: z.number().min(0).max(1),
});

const TOOL: SupportAITool = {
  name: "emit_insight",
  description:
    "Return a manager-grade insight narrative about the provided metrics payload.",
  inputSchema: {
    type: "object",
    required: ["headline", "summary", "recommendation", "priority", "confidence"],
    properties: {
      headline: {
        type: "string",
        description:
          "A single short sentence (under 140 chars) stating the most commercially important finding.",
      },
      summary: {
        type: "string",
        description:
          "Two-to-three sentences that cite specific numbers from the payload and explain why this matters.",
      },
      recommendation: {
        type: "string",
        description:
          "One concrete action the manager can take this week. Never vague. Never platitudes.",
      },
      priority: {
        type: "string",
        enum: ["HIGH", "MEDIUM", "LOW"],
        description:
          "HIGH if $ or customer impact is material; MEDIUM if notable; LOW if informational.",
      },
      confidence: {
        type: "number",
        description:
          "0–1. Use <0.5 only when the underlying sample is small (fewer than 10 items).",
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a commercial analytics assistant for an
Australian scooter and motorbike hire business. You receive a JSON payload
of business metrics and you MUST call the emit_insight tool exactly once.

Rules:
- Use Australian English, GST-inclusive, AUD pricing.
- Never invent numbers: only cite values present in the payload.
- Be concrete. No platitudes like "customer satisfaction is important".
- Recommendation must be actionable within one week by a depot manager.
- No emojis. No exclamation marks. No bullet points.
- If the payload is empty or too small, still emit a narrative with
  confidence < 0.5 and suggest collecting more data.`;

export async function narrateInsight(
  payload: InsightPayload,
): Promise<InsightNarrative> {
  const cfg = getSupportConfig();
  try {
    if (!cfg.aiEnabled) throw new SupportAIUnavailableError("AI disabled");
    const provider = getSupportAIProvider(cfg);

    const messages: SupportAIMessage[] = [
      {
        role: "user",
        content: buildUserPrompt(payload),
      },
    ];

    const narrative = await runToolCall(provider, messages);
    if (narrative) return narrative;
  } catch (err) {
    logger.warn({ err, insightId: payload.id }, "insight narration failed");
  }
  return fallbackNarrative(payload);
}

async function runToolCall(
  provider: ReturnType<typeof getSupportAIProvider>,
  messages: SupportAIMessage[],
): Promise<InsightNarrative | null> {
  for await (const chunk of provider.streamChat({
    system: SYSTEM_PROMPT,
    messages,
    tools: [TOOL],
  })) {
    if (chunk.kind === "tool_use" && chunk.toolCall.name === "emit_insight") {
      const parsed = narrativeSchema.safeParse(chunk.toolCall.input);
      if (parsed.success) {
        return {
          ...parsed.data,
          confidence: Number(parsed.data.confidence.toFixed(2)),
        };
      }
      logger.warn({ errors: parsed.error.flatten() }, "insight narrative schema failed");
      return null;
    }
  }
  return null;
}

function buildUserPrompt(payload: InsightPayload): string {
  const meta = INSIGHT_META[payload.id];
  const context = INSIGHT_CONTEXT[payload.id];
  const lean = leanPayload(payload);
  return [
    `Insight id: ${payload.id}`,
    `Pillar: ${meta.pillar}`,
    `Title: ${meta.title}`,
    `Domain context: ${context}`,
    `Payload JSON:`,
    "```json",
    JSON.stringify(lean, null, 2),
    "```",
  ].join("\n");
}

/**
 * Some payloads (e.g. top 20 customers) contain PII we do not need to ship
 * to the model. Strip down to the shape that informs the narrative.
 */
function leanPayload(payload: InsightPayload): unknown {
  switch (payload.id) {
    case "top-customers-at-risk":
      return {
        id: payload.id,
        atRiskCount: payload.atRiskCount,
        atRiskSpend: payload.atRiskSpend,
        totalRows: payload.rows.length,
        topRiskSample: payload.rows
          .filter((r) => r.atRisk)
          .slice(0, 5)
          .map((r) => ({
            daysSinceLastBooking: r.daysSinceLastBooking,
            totalSpend: r.totalSpend,
            totalBookings: r.totalBookings,
            riskRating: r.riskRating,
          })),
      };
    case "repeat-cohort":
      return {
        id: payload.id,
        overallRepeatRate: payload.overallRepeatRate,
        bestCohort: payload.bestCohort,
        cohortSummary: payload.cohorts.map((c) => ({
          cohortMonth: c.cohortMonth,
          newCustomers: c.newCustomers,
          totalReturned: c.returnedByMonth.reduce((a, b) => a + b, 0),
        })),
      };
    case "revenue-per-vehicle-day":
      return {
        id: payload.id,
        fleetAverage: payload.fleetAverage,
        top: payload.top,
        bottom: payload.bottom,
        vehicleCount: payload.rows.length,
      };
    case "maintenance-vs-revenue":
      return {
        id: payload.id,
        lossMakerCount: payload.lossMakerCount,
        totalNet: payload.totalNet,
        medianRevenue: payload.medianRevenue,
        medianMaintenance: payload.medianMaintenance,
        lossMakers: payload.points
          .filter((p) => p.lossMaker)
          .slice(0, 10)
          .map((p) => ({
            label: p.label,
            revenue: p.revenue,
            maintenanceCost: p.maintenanceCost,
            net: p.net,
          })),
      };
    case "revenue-trend":
      return {
        id: payload.id,
        months: payload.months,
        mom: payload.mom,
        yoy: payload.yoy,
        latestMonth: payload.latestMonth,
      };
    case "acquisition-conversion":
      return {
        id: payload.id,
        overallConversionRate: payload.overallConversionRate,
        bestSource: payload.bestSource,
        worstSource: payload.worstSource,
        sources: payload.sources,
      };
  }
}

const INSIGHT_CONTEXT: Record<InsightPayload["id"], string> = {
  "repeat-cohort":
    "Repeat booking behaviour across cohorts. overallRepeatRate is the share of first-time customers who book again within 6 months. Higher is better; below 20% is a retention problem.",
  "top-customers-at-risk":
    "The 20 highest-LTV customers. An at-risk customer has not booked in 90+ days. Keeping these customers is cheaper than acquiring new ones.",
  "revenue-per-vehicle-day":
    "Revenue per day each vehicle was on the road in the last 90 days. Dividing revenue by vehicle-available-days normalises for fleet size and newly onboarded bikes.",
  "maintenance-vs-revenue":
    "Net contribution per vehicle over the last 12 months = booking revenue minus completed work-order cost. A loss-maker has net < 0.",
  "revenue-trend":
    "Monthly total revenue from DailyRevenue over the last 12 months, with the same month a year ago for comparison. MoM = latest month vs previous month. YoY = latest month vs same month last year.",
  "acquisition-conversion":
    "Visitor sessions over the last 30 days grouped by utmSource. A session converts when it produces a booking. Sources with fewer than 20 sessions are excluded from best/worst ranking.",
};

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

export function fallbackNarrative(payload: InsightPayload): InsightNarrative {
  switch (payload.id) {
    case "repeat-cohort": {
      const pct = Math.round(payload.overallRepeatRate * 100);
      const priority: InsightPriority = pct < 20 ? "HIGH" : pct < 35 ? "MEDIUM" : "LOW";
      return {
        headline: `${pct}% of first-time customers come back`,
        summary: `Across the last 12 cohort months, ${pct}% of first-time customers made at least one return booking within six months. ${
          payload.bestCohort
            ? `The ${payload.bestCohort.month} cohort led with ${Math.round(payload.bestCohort.rate * 100)}%.`
            : ""
        }`.trim(),
        recommendation:
          pct < 25
            ? "Run a win-back email campaign targeting cohorts older than 90 days with a repeat-hire discount code."
            : "Keep the current post-return email cadence and evaluate whether the loyalty tier thresholds could move higher.",
        priority,
        confidence: 0.6,
      };
    }
    case "top-customers-at-risk": {
      const priority: InsightPriority =
        payload.atRiskSpend > 10_000 ? "HIGH" : payload.atRiskCount > 3 ? "MEDIUM" : "LOW";
      return {
        headline: `${payload.atRiskCount} top customers have gone quiet`,
        summary: `Of your 20 highest-spending customers, ${payload.atRiskCount} have not booked in the last 90 days, representing $${payload.atRiskSpend.toFixed(0)} of lifetime value.`,
        recommendation:
          "Have a manager call the top five at-risk customers this week with a personal offer; log outreach in the customer record.",
        priority,
        confidence: 0.7,
      };
    }
    case "revenue-per-vehicle-day": {
      const avg = payload.fleetAverage;
      return {
        headline: `Fleet averages $${avg.toFixed(0)} per vehicle-day`,
        summary: `Top performer: ${payload.top[0]?.label ?? "n/a"} at $${payload.top[0]?.value.toFixed(0) ?? "0"}/day. Bottom performer: ${payload.bottom[0]?.label ?? "n/a"} at $${payload.bottom[0]?.value.toFixed(0) ?? "0"}/day.`,
        recommendation:
          "Rebalance the bottom 5 by category or depot, or rotate them into peak-demand pickup locations.",
        priority: "MEDIUM",
        confidence: 0.6,
      };
    }
    case "maintenance-vs-revenue":
      return {
        headline: `${payload.lossMakerCount} vehicles lost money this year`,
        summary: `Net fleet contribution is $${payload.totalNet.toFixed(0)}. Median vehicle revenue $${payload.medianRevenue.toFixed(0)} against median maintenance $${payload.medianMaintenance.toFixed(0)}.`,
        recommendation:
          "Review the loss-makers for decommissioning or category reassignment; check warranty status before major spend.",
        priority: payload.lossMakerCount > 2 ? "HIGH" : "MEDIUM",
        confidence: 0.6,
      };
    case "revenue-trend": {
      const yoy = payload.yoy.changePct;
      return {
        headline:
          yoy === null
            ? "Latest month revenue snapshot"
            : yoy >= 0
              ? `Revenue up ${yoy.toFixed(1)}% year-on-year`
              : `Revenue down ${Math.abs(yoy).toFixed(1)}% year-on-year`,
        summary: `${payload.latestMonth ?? "Latest month"} vs prior year: MoM ${payload.mom.changePct?.toFixed(1) ?? "n/a"}%, YoY ${yoy?.toFixed(1) ?? "n/a"}%.`,
        recommendation:
          yoy !== null && yoy < -5
            ? "Investigate the gap by depot and category; compare yield-multiplier activity and cancellation rate for the same window."
            : "Maintain current yield settings and review again next month.",
        priority: yoy !== null && yoy < -5 ? "HIGH" : "LOW",
        confidence: 0.7,
      };
    }
    case "acquisition-conversion":
      return {
        headline: `${payload.overallConversionRate.toFixed(2)}% of visitors book`,
        summary: payload.bestSource
          ? `${payload.bestSource.source} leads at ${payload.bestSource.conversionRate.toFixed(2)}%, while ${payload.worstSource?.source ?? "others"} trails at ${payload.worstSource?.conversionRate.toFixed(2) ?? "n/a"}%.`
          : `Conversion stable across ${payload.sources.length} sources.`,
        recommendation:
          "Shift a share of underperforming channel spend into the leading source and test a dedicated landing page.",
        priority: "MEDIUM",
        confidence: 0.6,
      };
  }
}
