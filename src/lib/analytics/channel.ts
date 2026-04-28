import type { TrafficChannel } from "@prisma/client";

/**
 * Classify a visitor session into a single acquisition channel. Runs
 * at session-create time on the server so the column can be grouped
 * directly by the analytics queries without needing to rebuild the
 * classification every read.
 *
 *  PAID      — utm_medium contains "cpc" | "paid" | "ppc"
 *  EMAIL     — utm_medium contains "email" or utm_source === "newsletter"
 *  SOCIAL    — utm_source looks like a known social network
 *  DIRECT    — no referrer and no utm_source (typed URL / bookmark)
 *  ORGANIC   — referrer is a search engine and no utm_source
 *  REFERRAL  — referrer present but not a search engine, no utm_source
 *  OTHER     — fallback (utm_source present but doesn't fit above)
 */
export function classifyChannel(
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
  referrer: string | null | undefined,
): TrafficChannel {
  const src = utmSource?.toLowerCase() ?? "";
  const med = utmMedium?.toLowerCase() ?? "";
  if (med.includes("cpc") || med.includes("paid") || med.includes("ppc")) return "PAID";
  if (med.includes("email") || src === "newsletter") return "EMAIL";
  if (
    src.includes("facebook") ||
    src.includes("instagram") ||
    src.includes("tiktok") ||
    src.includes("linkedin") ||
    src.includes("twitter") ||
    src.includes("x.com") ||
    src.includes("youtube")
  ) {
    return "SOCIAL";
  }
  if (!utmSource && !referrer) return "DIRECT";
  if (referrer && /google|bing|duckduckgo|yahoo|ecosia|brave/.test(referrer) && !utmSource) {
    return "ORGANIC";
  }
  if (referrer && !utmSource) return "REFERRAL";
  return "OTHER";
}
