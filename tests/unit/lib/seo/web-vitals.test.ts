import { describe, it, expect, vi } from "vitest";
import { reportWebVital } from "@/lib/seo/web-vitals";

describe("reportWebVital", () => {
  it("captures a web_vital event with normalised props", () => {
    const capture = vi.fn();
    reportWebVital(
      { name: "LCP", value: 2500.4, id: "v1", rating: "good", navigationType: "navigate" },
      { capture },
    );
    expect(capture).toHaveBeenCalledWith(
      "web_vital",
      expect.objectContaining({
        metric_name: "LCP",
        metric_value: 2500.4,
        metric_id: "v1",
        metric_rating: "good",
        metric_navigation_type: "navigate",
      }),
    );
  });

  it("omits rating/navigationType when absent", () => {
    const capture = vi.fn();
    reportWebVital({ name: "CLS", value: 0.01, id: "v2" }, { capture });
    const props = capture.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(props).not.toHaveProperty("metric_rating");
    expect(props).not.toHaveProperty("metric_navigation_type");
  });

  it("no-ops when PostHog is unavailable", () => {
    expect(() =>
      reportWebVital({ name: "INP", value: 100, id: "v3" }, undefined),
    ).not.toThrow();
  });
});
