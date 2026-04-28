import { describe, expect, test } from "vitest";
import { classifyChannel } from "@/lib/analytics/channel";

describe("classifyChannel", () => {
  test("DIRECT when no referrer and no utm", () => {
    expect(classifyChannel(null, null, null)).toBe("DIRECT");
  });

  test("ORGANIC for search-engine referrers with no utm", () => {
    expect(classifyChannel(null, null, "www.google.com")).toBe("ORGANIC");
    expect(classifyChannel(null, null, "bing.com")).toBe("ORGANIC");
    expect(classifyChannel(null, null, "duckduckgo.com")).toBe("ORGANIC");
  });

  test("REFERRAL for a non-search referrer with no utm", () => {
    expect(classifyChannel(null, null, "somenewssite.com.au")).toBe("REFERRAL");
  });

  test("PAID when utm_medium contains cpc/paid/ppc", () => {
    expect(classifyChannel("google", "cpc", null)).toBe("PAID");
    expect(classifyChannel("bing", "paid_search", null)).toBe("PAID");
    expect(classifyChannel("meta", "ppc", null)).toBe("PAID");
  });

  test("EMAIL for utm_medium=email or utm_source=newsletter", () => {
    expect(classifyChannel("newsletter", null, null)).toBe("EMAIL");
    expect(classifyChannel("campaign-a", "email", null)).toBe("EMAIL");
  });

  test("SOCIAL for known social network utm_sources", () => {
    expect(classifyChannel("facebook", "social", null)).toBe("SOCIAL");
    expect(classifyChannel("instagram", "social", null)).toBe("SOCIAL");
    expect(classifyChannel("tiktok", null, null)).toBe("SOCIAL");
    expect(classifyChannel("linkedin", null, null)).toBe("SOCIAL");
    expect(classifyChannel("youtube", null, null)).toBe("SOCIAL");
  });

  test("PAID precedence: utm_medium=cpc wins over SOCIAL source", () => {
    // Someone running a paid Facebook campaign — PAID is the right
    // classification because the medium says it's paid, even though the
    // source network is social. This is consistent with GA4 / Zoho.
    expect(classifyChannel("facebook", "cpc", null)).toBe("PAID");
  });

  test("OTHER for a utm_source that doesn't fit any bucket and no referrer", () => {
    expect(classifyChannel("partner-a", null, null)).toBe("OTHER");
  });
});
